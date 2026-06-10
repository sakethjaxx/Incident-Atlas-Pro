import { tokenizeForRetrieval, getRagConfig } from "@pkg/nlp";
import { searchIncidents, retrieveChunkEvidence } from "./retrieval.js";
import {
  getQaModel,
  tryOllamaAnswer,
  QA_PROMPT_VERSION_LOCAL,
  QA_PROMPT_VERSION_OLLAMA,
  OLLAMA_CONTEXT_CHUNKS,
} from "./qaGenerate.js";

export const QA_PROMPT_VERSION = QA_PROMPT_VERSION_LOCAL;
/** Legacy constant — the active model now depends on QA_PROVIDER (see getQaModel). */
export const QA_MODEL = {
  provider: "local",
  name: "extractive-citation-v1",
  version: null,
};

const MAX_QUESTION_LENGTH = 1000;
const DEFAULT_EVIDENCE_LIMIT = 8;
const MAX_EVIDENCE_LIMIT = 12;
const SEARCH_LIMIT = 20;
const MAX_CITED_SECTIONS = 3;
const MIN_STRONG_SECTION_SCORE = 0.25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNSAFE_PATTERNS = [
  /ignore (all )?(previous|prior|above) (instructions|rules)/i,
  /system prompt/i,
  /developer message/i,
  /jailbreak/i,
  /do not cite/i,
  /without citations?/i,
  /forget (the )?(rules|instructions)/i,
];

export class QaValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "QaValidationError";
    this.status = 400;
  }
}

export async function answerQuestion(client, body) {
  const request = validateQaRequest(body);
  const config = getRagConfig();

  if (hasUnsafePromptText(request.question)) {
    return buildRefusal({
      reasonCode: "unsafe_prompt",
      message: "I cannot follow instructions that try to bypass citation requirements.",
      evidenceCount: 0,
      debug: request.mode === "eval" ? { unsafePrompt: true } : null,
    });
  }

  const retrieval = await retrieveEvidence(client, request, config);
  const unsafeEvidence = retrieval.evidence.find((item) => hasUnsafePromptText(item.text));
  if (unsafeEvidence) {
    return buildRefusal({
      reasonCode: "unsafe_prompt",
      message: "I cannot answer from evidence that contains unsafe prompt instructions.",
      retrievedEvidence: retrieval.evidence,
      debug:
        request.mode === "eval"
          ? { unsafeEvidenceSectionId: unsafeEvidence.sectionId }
          : null,
    });
  }

  const gate = assessSufficiency(request, retrieval.evidence);
  if (!gate.ok) {
    return buildRefusal({
      reasonCode: gate.reasonCode,
      message: gate.message,
      retrievedEvidence: retrieval.evidence,
      debug: request.mode === "eval" ? gate.debug : null,
    });
  }

  const contextSize =
    config.qa.provider === "ollama" ? OLLAMA_CONTEXT_CHUNKS : MAX_CITED_SECTIONS;
  const selectedEvidence = gate.evidence.slice(0, contextSize);
  const citations = selectedEvidence.map((item, index) => toCitation(item, index));

  // Generation: optional Ollama/Qwen path, deterministic extractive fallback.
  let answer = null;
  let model = getQaModel(config);
  let promptVersion = QA_PROMPT_VERSION_LOCAL;
  let generationDebug = null;

  if (config.qa.provider === "ollama") {
    const generated = await tryOllamaAnswer({ question: request.question, citations }, config);
    if (generated?.insufficient) {
      return buildRefusal({
        reasonCode: "insufficient_evidence",
        message: "I do not have enough cited incident evidence to answer that.",
        retrievedEvidence: retrieval.evidence,
        debug: request.mode === "eval" ? { modelDeclaredInsufficient: true } : null,
      });
    }
    if (generated?.answer) {
      const generatedValidation = validateAnswerCitations(
        generated.answer,
        citations,
        selectedEvidence
      );
      if (generatedValidation.ok) {
        answer = generated.answer;
        promptVersion = QA_PROMPT_VERSION_OLLAMA;
      } else {
        generationDebug = { ollamaRejected: generatedValidation.reason };
      }
    }
    if (!answer) {
      // Degrade to the deterministic extractive answer — still fully cited.
      model = { provider: "local", name: "extractive-citation-v1", version: null };
    }
  }

  if (!answer) {
    answer = buildExtractiveAnswer(citations.slice(0, MAX_CITED_SECTIONS));
  }

  const validation = validateAnswerCitations(answer, citations, selectedEvidence);
  if (!validation.ok) {
    return buildRefusal({
      reasonCode: "citation_validation_failed",
      message: "I could not produce a fully cited answer from the retrieved evidence.",
      retrievedEvidence: retrieval.evidence,
      debug: request.mode === "eval" ? validation : null,
    });
  }

  const sourceIncidents = buildSourceIncidents(selectedEvidence);
  const response = {
    status: "answered",
    answer,
    citations,
    refusal: null,
    evidenceCount: retrieval.evidence.length,
    confidence: calculateConfidence(selectedEvidence),
    sourceIncidents,
    promptVersion,
    model,
    audit: {
      action: "qa.answer",
      retrievedSectionIds: selectedEvidence.map((item) => item.sectionId),
      retrievedIncidentIds: sourceIncidents.map((incident) => incident.id),
      refusalCode: null,
    },
  };

  if (request.mode === "eval") {
    response.debug = {
      ...(generationDebug ?? {}),
      retrieval: retrieval.meta ?? { path: "legacy-sections" },
      retrievalTraces: retrieval.traces ?? null,
    };
  }

  return response;
}

export function validateQaRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new QaValidationError("Request body must be an object");
  }

  const question = stringField(body.question, "question");
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new QaValidationError("question must be 1000 characters or fewer");
  }

  const filters = validateFilters(body.filters ?? {});
  const options = validateOptions(body.options ?? {});
  return {
    question,
    filters,
    ...options,
  };
}

export async function retrieveEvidence(client, request, config = getRagConfig()) {
  // Sprint 5 path: chunk-level hybrid retrieval (filters → FTS+vector → RRF →
  // rerank). Falls back to the legacy section-level path when the chunk index
  // is empty or unavailable, so pre-chunk deployments keep working unchanged.
  const chunkResult = await retrieveChunkEvidence(client, {
    q: request.question,
    filters: {
      company: request.filters.company,
      severity: null,
      tag: request.filters.tags[0] ?? null,
      incidentIds: request.filters.incidentIds,
    },
    limit: Math.max(request.maxEvidenceSections, 8),
    debug: request.mode === "eval",
    config,
  });

  if (chunkResult && chunkResult.evidence.length > 0) {
    const evidence = chunkResult.evidence.filter((item) =>
      matchesPostFilters(
        { id: item.incidentId, company: item.company, tags: item.tags },
        request.filters
      )
    );

    if (evidence.length > 0) {
      if (request.includeGraphContext) {
        const incidentIds = [...new Set(evidence.map((item) => item.incidentId))];
        const graphEvidence = await fetchGraphEvidence(client, incidentIds);
        evidence.push(...graphEvidence);
      }
      return {
        evidence: dedupeAndRankEvidence(evidence, request.maxEvidenceSections),
        traces: chunkResult.traces,
        meta: { path: "chunks", ...chunkResult.meta },
      };
    }
  }

  return retrieveLegacySectionEvidence(client, request);
}

async function retrieveLegacySectionEvidence(client, request) {
  const searchResult = await searchIncidents(client, {
    q: request.question,
    page: 1,
    limit: SEARCH_LIMIT,
    skip: 0,
    filters: {
      company: request.filters.company,
      severity: null,
      tag: request.filters.tags[0] ?? null,
      from: null,
      to: null,
    },
  });

  const evidence = [];
  const incidentsById = new Map();
  for (const item of searchResult.data ?? []) {
    const incident = item.incident ?? item;
    if (!incident?.id) continue;
    if (!matchesPostFilters(incident, request.filters)) continue;
    incidentsById.set(incident.id, incident);

    for (const section of item.matchedSections ?? item.sections ?? []) {
      evidence.push(toEvidenceItem({ incident, section, score: section.score ?? item.score }));
    }
  }

  if (request.includeGraphContext) {
    const graphEvidence = await fetchGraphEvidence(client, [...incidentsById.keys()]);
    evidence.push(...graphEvidence);
  }

  return {
    evidence: dedupeAndRankEvidence(evidence, request.maxEvidenceSections),
    traces: null,
    meta: { path: "legacy-sections" },
  };
}

function validateFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new QaValidationError("filters must be an object");
  }

  const company =
    filters.company === undefined || filters.company === null
      ? null
      : stringField(filters.company, "filters.company");
  const tags =
    filters.tags === undefined || filters.tags === null
      ? []
      : arrayOfStrings(filters.tags, "filters.tags");
  const incidentIds =
    filters.incidentIds === undefined || filters.incidentIds === null
      ? []
      : arrayOfUuids(filters.incidentIds, "filters.incidentIds");

  return { company, tags, incidentIds };
}

function validateOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new QaValidationError("options must be an object");
  }

  const maxEvidenceSections =
    options.maxEvidenceSections === undefined
      ? DEFAULT_EVIDENCE_LIMIT
      : parseBoundedInt(
          options.maxEvidenceSections,
          "options.maxEvidenceSections",
          1,
          MAX_EVIDENCE_LIMIT
        );
  const includeGraphContext =
    options.includeGraphContext === undefined ? true : Boolean(options.includeGraphContext);
  const mode = options.mode ?? "answer";
  if (!["answer", "eval"].includes(mode)) {
    throw new QaValidationError("options.mode must be answer or eval");
  }

  return { maxEvidenceSections, includeGraphContext, mode };
}

function assessSufficiency(request, evidence) {
  if (evidence.length === 0) {
    return insufficient("insufficient_evidence", "I do not have enough cited incident evidence to answer that.", {
      evidenceCount: 0,
    });
  }

  const intent = detectIntent(request.question);
  if (intent === "unsafe_prompt") {
    return insufficient("unsafe_prompt", "I cannot follow instructions that try to bypass citation requirements.");
  }

  if (isComparisonQuestion(request.question)) {
    const incidentCount = new Set(evidence.map((item) => item.incidentId)).size;
    if (incidentCount < 2) {
      return insufficient(
        "insufficient_evidence",
        "I do not have enough cited incident evidence to compare incidents.",
        { incidentCount }
      );
    }
  }

  const questionTokens = new Set(tokenizeForRetrieval(request.question));
  const candidateEvidence = evidence
    .map((item) => ({
      ...item,
      tokenOverlap: countOverlap(
        questionTokens,
        tokenizeForRetrieval(`${item.sectionType} ${item.text}`)
      ),
    }))
    .filter((item) => item.retrievalScore >= MIN_STRONG_SECTION_SCORE || item.tokenOverlap > 0);

  if (candidateEvidence.length === 0) {
    return insufficient("insufficient_evidence", "I do not have enough cited incident evidence to answer that.", {
      topScore: evidence[0]?.retrievalScore ?? 0,
    });
  }

  // At least one piece of directly-retrieved evidence (not graph context) must
  // qualify, or the question is out of scope for the corpus.
  if (!candidateEvidence.some((item) => !item.fromGraphContext)) {
    return insufficient("insufficient_evidence", "I do not have enough cited incident evidence to answer that.", {
      onlyGraphContext: true,
    });
  }

  const intentEvidence =
    intent.sectionType === null
      ? candidateEvidence
      : candidateEvidence.filter((item) => item.sectionType === intent.sectionType);

  if (intent.sectionType && intentEvidence.length === 0) {
    return insufficient(
      "insufficient_evidence",
      `I do not have enough cited ${intent.sectionType} evidence to answer that.`,
      { requiredSectionType: intent.sectionType }
    );
  }

  return { ok: true, evidence: intentEvidence };
}

function detectIntent(question) {
  const q = question.toLowerCase();
  if (hasUnsafePromptText(question)) return "unsafe_prompt";
  if (/\b(fix|fixed|resolve|resolved|resolution|mitigate|mitigation|remediate|rollback|rolled back)\b/.test(q)) {
    return { sectionType: "fix" };
  }
  if (/\b(root cause|rootcause|caused|cause|why|triggered)\b/.test(q)) {
    return { sectionType: "rootcause" };
  }
  if (/\b(impact|affected|outage|customer|user|effect)\b/.test(q)) {
    return { sectionType: "impact" };
  }
  if (/\b(when|timeline|during|after|before|sequence)\b/.test(q)) {
    return { sectionType: "timeline" };
  }
  return { sectionType: null };
}

function isComparisonQuestion(question) {
  return /\b(compare|versus|vs\.?|difference|different|similar)\b/i.test(question);
}

function insufficient(reasonCode, message, debug = null) {
  return { ok: false, reasonCode, message, debug };
}

function buildExtractiveAnswer(citations) {
  return citations
    .map((citation) => {
      const sentence = stripTrailingSentencePunctuation(firstSentence(citation.excerpt));
      return `${sentence} [${citation.label}].`;
    })
    .join(" ");
}

function validateAnswerCitations(answer, citations, evidence) {
  const labels = new Set(citations.map((citation) => citation.label));
  const evidenceSectionIds = new Set(evidence.map((item) => item.sectionId));
  const sentences = answer.split(/(?<=[.!?])\s+/).filter(Boolean);

  if (sentences.length === 0) return { ok: false, reason: "empty_answer" };
  for (const sentence of sentences) {
    if (!/\[C\d+\]/.test(sentence)) {
      return { ok: false, reason: "uncited_sentence" };
    }
  }
  // Every label used in the answer must refer to a provided evidence block
  // (guards against generated answers hallucinating citation labels).
  for (const used of answer.match(/\[C\d+\]/g) ?? []) {
    if (!labels.has(used.slice(1, -1))) {
      return { ok: false, reason: "unknown_citation_label" };
    }
  }
  for (const citation of citations) {
    if (!labels.has(citation.label) || !evidenceSectionIds.has(citation.sectionId)) {
      return { ok: false, reason: "citation_outside_evidence" };
    }
  }
  return { ok: true };
}

function toCitation(item, index) {
  return {
    label: `C${index + 1}`,
    incidentId: item.incidentId,
    sectionId: item.sectionId,
    sectionType: item.sectionType,
    title: item.title,
    company: item.company,
    date: item.date ? new Date(item.date).toISOString() : null,
    excerpt: truncateExcerpt(item.text),
    anchor: `#section-${item.sectionType}-${item.sectionId}`,
    retrievalScore: round(item.retrievalScore),
  };
}

function buildRefusal({
  reasonCode,
  message,
  evidenceCount = null,
  retrievedEvidence = [],
  debug = null,
}) {
  const sourceIncidents = [];
  const response = {
    status: "refused",
    answer: null,
    citations: [],
    refusal: {
      reasonCode,
      message,
    },
    evidenceCount: evidenceCount ?? retrievedEvidence.length,
    confidence: 0,
    sourceIncidents,
    promptVersion: QA_PROMPT_VERSION,
    model: QA_MODEL,
    audit: {
      action: "qa.refuse",
      retrievedSectionIds: retrievedEvidence.map((item) => item.sectionId),
      retrievedIncidentIds: buildSourceIncidents(retrievedEvidence).map(
        (incident) => incident.id
      ),
      refusalCode: reasonCode,
    },
  };

  if (debug) response.debug = debug;
  return response;
}

function buildSourceIncidents(evidence) {
  const seen = new Set();
  const incidents = [];
  for (const item of evidence) {
    if (seen.has(item.incidentId)) continue;
    seen.add(item.incidentId);
    incidents.push({
      id: item.incidentId,
      title: item.title,
      company: item.company,
      date: item.date ? new Date(item.date).toISOString() : null,
      severity: item.severity,
    });
  }
  return incidents;
}

async function fetchGraphEvidence(client, incidentIds) {
  if (incidentIds.length === 0) return [];
  const edges = await client.graphEdge.findMany({
    where: { incidentId: { in: incidentIds } },
    include: {
      evidenceSection: {
        include: { incident: true },
      },
    },
  });

  return edges
    .filter((edge) => edge.evidenceSection?.incident)
    .map((edge) => ({
      ...toEvidenceItem({
        incident: edge.evidenceSection.incident,
        section: edge.evidenceSection,
        score: 0.35,
      }),
      // Graph context may enrich an answer but must never justify one alone
      // (see assessSufficiency) — otherwise off-topic questions that retrieve
      // weak candidates inherit "strong" graph evidence and dodge refusal.
      fromGraphContext: true,
    }));
}

function toEvidenceItem({ incident, section, score }) {
  return {
    incidentId: incident.id,
    sectionId: section.id,
    sectionType: section.type,
    text: section.text,
    title: incident.title,
    company: incident.company,
    date: incident.date,
    severity: incident.severity,
    tags: incident.tags ?? [],
    retrievalScore: Number.isFinite(score) ? Number(score) : 0,
  };
}

function dedupeAndRankEvidence(items, limit) {
  const bestBySection = new Map();
  for (const item of items) {
    const existing = bestBySection.get(item.sectionId);
    if (!existing || item.retrievalScore > existing.retrievalScore) {
      bestBySection.set(item.sectionId, item);
    }
  }

  return [...bestBySection.values()]
    .sort((left, right) => {
      if (right.retrievalScore !== left.retrievalScore) {
        return right.retrievalScore - left.retrievalScore;
      }
      return sectionPriority(left.sectionType) - sectionPriority(right.sectionType);
    })
    .slice(0, limit);
}

function matchesPostFilters(incident, filters) {
  if (filters.incidentIds.length > 0 && !filters.incidentIds.includes(incident.id)) {
    return false;
  }
  if (
    filters.company &&
    String(incident.company ?? "").toLowerCase() !== filters.company.toLowerCase()
  ) {
    return false;
  }
  if (filters.tags.length > 0) {
    const incidentTags = new Set((incident.tags ?? []).map((tag) => String(tag).toLowerCase()));
    return filters.tags.every((tag) => incidentTags.has(tag.toLowerCase()));
  }
  return true;
}

function calculateConfidence(evidence) {
  if (evidence.length === 0) return 0;
  const topScore = Math.max(...evidence.map((item) => item.retrievalScore));
  const evidenceBoost = Math.min(0.15, evidence.length * 0.05);
  return round(Math.min(0.95, topScore / (topScore + 1) + evidenceBoost));
}

function countOverlap(leftSet, rightTokens) {
  const seen = new Set();
  let count = 0;
  for (const token of rightTokens) {
    if (leftSet.has(token) && !seen.has(token)) {
      seen.add(token);
      count += 1;
    }
  }
  return count;
}

function hasUnsafePromptText(text) {
  return UNSAFE_PATTERNS.some((pattern) => pattern.test(String(text ?? "")));
}

function firstSentence(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
  return truncateSentence(match ? match[1] : clean);
}

function truncateSentence(text, maxChars = 260) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 3).trim()}...`;
}

function stripTrailingSentencePunctuation(text) {
  return String(text ?? "").trim().replace(/[.!?]+$/, "");
}

function truncateExcerpt(text, maxChars = 320) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 3).trim()}...`;
}

function sectionPriority(type) {
  return { rootcause: 1, fix: 2, impact: 3, timeline: 4 }[type] ?? 5;
}

function stringField(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new QaValidationError(`${field} is required`);
  }
  return value.trim();
}

function arrayOfStrings(value, field) {
  if (!Array.isArray(value)) {
    throw new QaValidationError(`${field} must be an array`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new QaValidationError(`${field}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
}

function arrayOfUuids(value, field) {
  return arrayOfStrings(value, field).map((item, index) => {
    if (!UUID_RE.test(item)) {
      throw new QaValidationError(`${field}[${index}] must be a valid UUID`);
    }
    return item;
  });
}

function parseBoundedInt(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new QaValidationError(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(4));
}
