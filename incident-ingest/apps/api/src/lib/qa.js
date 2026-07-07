import { tokenizeForRetrieval, getRagConfig } from "@pkg/nlp";
import { searchIncidents, retrieveChunkEvidence } from "@pkg/db";
import {
  DOCUMENT_SCOPE_SOURCE,
  PUBLIC_WEB_SCOPE_SOURCE,
  applyDocumentAccessScope,
  normalizeAccessScope,
  publicWebUnavailablePayload,
} from "./accessScope.js";
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

// Questions clearly outside the incident postmortem domain.
const OUT_OF_SCOPE_PATTERNS = [
  // Code/script generation requests
  /^(write|create|generate|produce|make me|give me)\s+(a\s+)?(bash|shell|python|javascript|typescript|sql|go|rust|java|ruby|php|c\+\+|powershell)\s+(script|program|function|code|command|snippet)\b/i,
  /^(write|create|generate)\s+(me\s+)?(a\s+)?(script|program|code)\s+(that|to|which|for)\b/i,
  // Weather / environmental forecast queries
  /\bweather (forecast|today|tomorrow|this week|this weekend|report)\b|\bforecast for\b|\bwill it rain\b/i,
  // Biographical leadership questions about people (not about incident handling)
  /\bwho (is|was|are|were) (the |a |an )?(ceo|cto|coo|cfo|founder|president|vice.?president|chairman|board member|director)\b/i,
  // Financial market data
  /\b(stock price|share price|market cap|nasdaq|nyse|trading at|stock market|ipo price)\b/i,
];

function isOutOfScopeRequest(question) {
  const q = String(question ?? "").trimStart();
  return OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(q));
}

const UNSAFE_PATTERNS = [
  // Word-order-agnostic: any "ignore ... instructions/rules/prompt/context" phrasing.
  // Previous regex required (previous|prior|above)? before (your)? which missed
  // "Ignore your previous instructions" because "your" precedes the optional word.
  /\bignore\b.{0,40}\b(instructions?|rules?|context|prompt)\b/i,
  /system prompt/i,
  /developer message/i,
  /jailbreak/i,
  /do not cite/i,
  /without citations?/i,
  /forget\b.{0,30}\b(rules?|instructions?|context)\b/i,
  /pretend (you are|to be) (a different|an? (unrestricted|unfiltered|uncensored))/i,
  /answer (freely|without restriction)/i,
  /bypass (the )?(safety|filter|restriction|rule|instruction)/i,
  /override (your )?(instruction|rule|guideline)/i,
  /how (to|do you) (hack|exploit|attack|breach|compromise)\b/i,
  /inject(ion)? (attack|payload|sql|xss|prompt)/i,
  // Additional jailbreak variants not covered by above
  /you (are|have) no restrictions?\b/i,
  /act as (an? )?(unrestricted|unfiltered|uncensored|different|new|another)/i,
  /disregard (your )?(previous|prior|all)? ?(instructions?|rules?|guidelines?)/i,
  /new (persona|role|identity|character).*no (restrictions?|limits?|rules?)/i,
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

  if (request.scope.source === PUBLIC_WEB_SCOPE_SOURCE) {
    return buildRefusal({
      reasonCode: "public_web_unavailable",
      message:
        "Public web research is separate from uploaded company documents and is not configured on this deployment.",
      evidenceCount: 0,
      scope: request.scope,
      debug: request.mode === "eval" ? publicWebUnavailablePayload(request.scope) : null,
    });
  }

  if (hasUnsafePromptText(request.question)) {
    return buildRefusal({
      reasonCode: "unsafe_prompt",
      message: "I cannot follow instructions that try to bypass citation requirements.",
      evidenceCount: 0,
      debug: request.mode === "eval" ? { unsafePrompt: true } : null,
    });
  }

  if (isOutOfScopeRequest(request.question)) {
    return buildRefusal({
      reasonCode: "unsupported_scope",
      message: "I only answer questions grounded in incident postmortem evidence. Code generation is outside my scope.",
      evidenceCount: 0,
      debug: request.mode === "eval" ? { outOfScope: true } : null,
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
  const citations = selectedEvidence.map((item, index) => toCitation(item, index, request.scope));

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
    answer = buildExtractiveAnswer(citations.slice(0, MAX_CITED_SECTIONS), request.question);
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
    scope: {
      ...request.scope,
      source: DOCUMENT_SCOPE_SOURCE,
    },
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
  const scope = normalizeAccessScope(body.scope ?? {}, filters.company);
  const options = validateOptions(body.options ?? {});
  return {
    question,
    filters,
    scope,
    ...options,
  };
}

export async function retrieveEvidence(client, request, config = getRagConfig()) {
  const scopedFilters = applyDocumentAccessScope(request.filters, request.scope);
  // Sprint 5 path: chunk-level hybrid retrieval (filters → FTS+vector → RRF →
  // rerank). Falls back to the legacy section-level path when the chunk index
  // is empty or unavailable, so pre-chunk deployments keep working unchanged.
  const chunkResult = await retrieveChunkEvidence(client, {
    q: request.question,
    filters: {
      company: scopedFilters.company,
      companies: scopedFilters.companies,
      severity: null,
      tag: scopedFilters.tags[0] ?? null,
      incidentIds: scopedFilters.incidentIds,
      from: scopedFilters.from ?? null,
      to: scopedFilters.to ?? null,
    },
    limit: Math.max(request.maxEvidenceSections, 8),
    debug: request.mode === "eval",
    config,
  });

  if (chunkResult && chunkResult.evidence.length > 0) {
    const evidence = chunkResult.evidence.filter((item) =>
      matchesPostFilters(
        { id: item.incidentId, company: item.company, tags: item.tags },
        scopedFilters
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
  const scopedFilters = applyDocumentAccessScope(request.filters, request.scope);
  const searchResult = await searchIncidents(client, {
    q: request.question,
    page: 1,
    limit: SEARCH_LIMIT,
    skip: 0,
    filters: {
      company: scopedFilters.company,
      companies: scopedFilters.companies,
      severity: null,
      tag: scopedFilters.tags[0] ?? null,
      from: scopedFilters.from ?? null,
      to: scopedFilters.to ?? null,
    },
  });

  const evidence = [];
  const incidentsById = new Map();
  for (const item of searchResult.data ?? []) {
    const incident = item.incident ?? item;
    if (!incident?.id) continue;
    if (!matchesPostFilters(incident, scopedFilters)) continue;
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

  const from = parseOptionalDate(filters.from, "filters.from");
  const to = parseOptionalDate(filters.to, "filters.to");
  if (from && to && from > to) {
    throw new QaValidationError("filters.from must be before filters.to");
  }

  return { company, tags, incidentIds, from, to };
}

function parseOptionalDate(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new QaValidationError(`${fieldName} must be an ISO-8601 date string`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new QaValidationError(`${fieldName} must be a valid ISO-8601 date`);
  return d;
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
  // "after"/"before" are prepositions used in many non-timeline contexts
  // ("improvements after the incident", "before deploying") — only require a
  // timeline section when an unambiguously temporal keyword is present.
  if (/\b(when|at what time|timeline|sequence of events|order of events|what time)\b/.test(q)) {
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

function buildExtractiveAnswer(citations, questionText = "") {
  const qTokens = new Set(tokenizeForRetrieval(questionText));
  return citations
    .map((citation) => {
      const sentences = splitSentences(citation.excerpt);
      // Score by question-token overlap; include ALL sentences with any overlap,
      // capped at 400 chars per citation so multi-fact questions get full coverage.
      const scored = sentences
        .map((s) => ({ s, hits: tokenizeForRetrieval(s).filter((t) => qTokens.has(t)).length }))
        .filter(({ hits }) => hits > 0);
      // Fallback: if nothing overlaps, just use the first sentence.
      const candidates = scored.length > 0 ? scored.sort((a, b) => b.hits - a.hits) : [{ s: sentences[0] ?? "", hits: 0 }];

      let excerpt = "";
      for (const { s } of candidates) {
        const clean = stripTrailingSentencePunctuation(truncateSentence(s, 220));
        if (!clean) continue;
        if (excerpt.length + clean.length + 2 > 420) break;
        excerpt += (excerpt ? "; " : "") + clean;
      }
      if (!excerpt) excerpt = stripTrailingSentencePunctuation(truncateSentence(sentences[0] ?? "", 260));
      return `${excerpt} [${citation.label}].`;
    })
    .join(" ");
}

function splitSentences(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  // Split on sentence-ending punctuation followed by space/end, but keep the dot.
  return clean.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
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

function toCitation(item, index, scope) {
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
    sourceAccess: buildCitationSourceAccess(item, scope),
  };
}

function buildCitationSourceAccess(item, scope) {
  const company = item.company ?? null;
  return {
    source: scope?.source ?? DOCUMENT_SCOPE_SOURCE,
    label: "Uploaded document",
    accessReason: company
      ? `Visible through the ${company} document scope.`
      : "Visible through your uploaded document scope.",
  };
}

function buildRefusal({
  reasonCode,
  message,
  evidenceCount = null,
  retrievedEvidence = [],
  debug = null,
  scope = null,
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
    scope,
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
  if (Array.isArray(filters.companies) && filters.companies.length > 0) {
    const allowedCompanies = new Set(filters.companies.map((company) => company.toLowerCase()));
    if (!allowedCompanies.has(String(incident.company ?? "").toLowerCase())) {
      return false;
    }
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
