/**
 * @pkg/nlp — Key-fact extraction from incident evidence
 *
 * Addresses Gap #1: Key-Fact Hit Rate 31%
 *
 * The extractive QA path returns whole sentences but often misses the specific
 * fact a user asked for (e.g. "how long was the outage?" → the sentence
 * containing the duration exists in evidence, but the extractor picks a
 * different sentence without the number).
 *
 * This module adds a focused fact extraction layer that:
 *   1. Detects the fact TYPE the question is asking about (duration, count,
 *      percentage, rate, time, service, cause, fix).
 *   2. Scans evidence sentences for the highest-confidence match.
 *   3. Returns the raw fact value + the sentence it came from for citation.
 *
 * Design notes
 * ────────────
 * • No regex look-behind that isn't universally supported (no \k<>).
 * • No external dependencies — pure ESM.
 * • Designed to be called BEFORE buildExtractiveAnswer() to pre-select the
 *   best evidence sentence, not to replace citation generation.
 */

// ── Fact-type patterns ────────────────────────────────────────────────────────
// Each entry: { type, questionPatterns[], extractPatterns[] }

const FACT_TYPES = [
  {
    type: "duration",
    questionPatterns: [
      /\b(how long|duration|outage duration|downtime|outage time|time to resolve|resolve time|resolution time|took|lasted|took to fix|took to recover)\b/i,
    ],
    extractPatterns: [
      // "20 minutes", "3 hours", "2.5 hours", "~30 min"
      /(?:~|approximately|about|around|nearly|over|under|less than|more than)?\s*(\d+(?:\.\d+)?)\s*(second|seconds|sec|minute|minutes|min|hour|hours|hr|hrs|day|days|week|weeks)\b/gi,
      // "for X minutes/hours"
      /for\s+(\d+(?:\.\d+)?)\s*(second|seconds|sec|minute|minutes|min|hour|hours|hr|hrs|day|days|week|weeks)\b/gi,
    ],
  },
  {
    type: "time",
    questionPatterns: [
      /\b(when|at what time|started|began|detected|start time|began at|started at|detected at|first seen|first occurred)\b/i,
    ],
    extractPatterns: [
      // "at 14:32 UTC", "at 2:30 AM PST", "2024-01-01 12:00"
      /at\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|UTC|GMT|PST|EST|CST|MST|PDT|EDT|CDT|MDT)?)/gi,
      // "on 2024-01-15" / "January 15"
      /(?:on\s+)?(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/gi,
      /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s+\d{4})?/gi,
    ],
  },
  {
    type: "percentage",
    questionPatterns: [
      /\b(what percentage|how much of|what fraction|error rate|success rate|availability|impact percentage|percent)\b/i,
    ],
    extractPatterns: [
      /(\d+(?:\.\d+)?)\s*(?:%|percent)/gi,
      /(\d+(?:\.\d+)?%)/gi,
    ],
  },
  {
    type: "count",
    questionPatterns: [
      /\b(how many|number of|count of|total|affected users|affected customers|requests|errors|failures|incidents)\b/i,
    ],
    extractPatterns: [
      // "500 errors", "10,000 users", "100% of requests"
      /(\d[\d,]*)\s+(user|users|customer|customers|request|requests|error|errors|failure|failures|query|queries|connection|connections|transaction|transactions)/gi,
      // "100% of", "50% of traffic"
      /(\d+(?:\.\d+)?)%\s*(?:of\s+\w+)?/gi,
    ],
  },
  {
    type: "cause",
    questionPatterns: [
      /\b(why|root cause|cause|what caused|triggered|led to|reason|responsible for|resulted in|source of)\b/i,
    ],
    extractPatterns: [
      // "root cause was X", "root cause: X"
      /root cause\b[^.!?\n]{0,20}\b(?:was|is|:)\s*[^.!?\n]{3,120}/i,
      // "caused by X"
      /caused by\s+[^.!?\n]{3,120}/i,
      // "due to X", "resulting from X", "triggered by X"
      /(?:due to|resulting from|triggered by|because of|owing to)\s+[^.!?\n]{3,120}/i,
    ],
  },
  {
    type: "fix",
    questionPatterns: [
      /\b(how|fixed|resolved|fix|solution|remediation|mitigation|what was done|how did|recovery action|what fixed)\b/i,
    ],
    extractPatterns: [
      // "by rolling back", "by deploying", "we fixed by", "resolved by"
      /(?:resolved by|fixed by|mitigated by|rolled back|reverted|deployed|restarted|scaled|disabled|increased|reduced)\s+(.{10,120}?)(?:[.!?]|$)/gi,
    ],
  },
  {
    type: "service",
    questionPatterns: [
      /\b(which service|what service|affected service|service name|component|system|database|api|endpoint)\b/i,
    ],
    extractPatterns: [
      // Service/component names — match PascalCase or quoted names
      /(?:service|component|system|database|api|cluster|pod|instance)\s+["']?([A-Z][A-Za-z0-9_-]{2,40}|[a-z][a-z0-9_-]{2,40})["']?/gi,
    ],
  },
];

// ── Sentence splitter ─────────────────────────────────────────────────────────

/**
 * Split text into sentences for fine-grained extraction.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoSentences(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  // Split on sentence-ending punctuation followed by space or end of string
  const parts = clean.match(/[^.!?\n]+[.!?\n]+(?:\s|$)|[^.!?\n]+$/g) ?? [clean];
  return parts.map((s) => s.trim()).filter(Boolean);
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Score how many extract-pattern matches a sentence has for a given fact type.
 *
 * @param {string} sentence
 * @param {{ extractPatterns: RegExp[] }} factType
 * @returns {{ score: number, matches: string[] }}
 */
function scoreSentence(sentence, factType) {
  const matches = [];
  for (const pattern of factType.extractPatterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = re.exec(sentence)) !== null) {
      // Use first capture group if present, otherwise the full match
      const value = (match[1] ?? match[0]).replace(/\s+/g, " ").trim();
      if (value && value.length >= 1) matches.push(value);
      // Safety guard against infinite loops on zero-length matches
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }
  return { score: matches.length, matches };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect which fact type the question is asking about.
 *
 * Returns the best matching fact type, or null if none match confidently.
 *
 * @param {string} question
 * @returns {{ type: string, extractPatterns: RegExp[] } | null}
 */
export function detectFactType(question) {
  for (const factType of FACT_TYPES) {
    for (const pattern of factType.questionPatterns) {
      if (pattern.test(question)) return factType;
    }
  }
  return null;
}

/**
 * Extract the key fact answer from a list of evidence items.
 *
 * Each evidence item should have: { text, sectionId, incidentId, ... }
 *
 * @param {string} question - The user's question
 * @param {Array<{ text: string, sectionId: string, incidentId: string }>} evidence
 * @returns {{
 *   found: boolean,
 *   factType: string | null,
 *   value: string | null,
 *   sentence: string | null,
 *   sectionId: string | null,
 *   incidentId: string | null,
 *   allMatches: string[]
 * }}
 */
export function extractKeyFact(question, evidence) {
  const factType = detectFactType(question);

  if (!factType) {
    return {
      found: false,
      factType: null,
      value: null,
      sentence: null,
      sectionId: null,
      incidentId: null,
      allMatches: [],
    };
  }

  let bestScore = 0;
  let bestSentence = null;
  let bestValue = null;
  let bestSectionId = null;
  let bestIncidentId = null;
  const allMatches = [];

  for (const item of evidence) {
    const sentences = splitIntoSentences(item.text ?? "");
    for (const sentence of sentences) {
      const { score, matches } = scoreSentence(sentence, factType);
      allMatches.push(...matches);
      if (score > bestScore) {
        bestScore = score;
        bestSentence = sentence;
        bestValue = matches[0] ?? null;
        bestSectionId = item.sectionId;
        bestIncidentId = item.incidentId;
      }
    }
  }

  return {
    found: bestScore > 0,
    factType: factType.type,
    value: bestValue,
    sentence: bestSentence,
    sectionId: bestSectionId,
    incidentId: bestIncidentId,
    allMatches: [...new Set(allMatches)].slice(0, 10),
  };
}

/**
 * Detect whether a question is a multi-incident comparison request.
 *
 * @param {string} question
 * @returns {boolean}
 */
export function isComparisonQuestion(question) {
  return /\b(compare|versus|vs\.?|vs\s|difference\s+between|how\s+(are|were|did)\s+.{1,50}different|similar(ity)?|contrast)\b/i.test(
    String(question ?? "")
  );
}

/**
 * Build a structured comparison answer from evidence spanning multiple incidents.
 *
 * Groups evidence by incidentId, selects best section for each relevant type
 * (impact, rootcause, fix), and returns a comparison table structure + a
 * prose answer with citations that can be validated.
 *
 * @param {string} question
 * @param {Array<{
 *   incidentId: string, sectionId: string, sectionType: string,
 *   text: string, title: string, company: string, date: any,
 *   retrievalScore: number
 * }>} evidence
 * @param {Array<{ label: string, incidentId: string, sectionId: string, excerpt: string }>} citations
 * @returns {{
 *   answer: string,
 *   comparisonTable: object[],
 *   hasComparison: boolean
 * }}
 */
export function buildComparisonAnswer(question, evidence, citations) {
  // Group by incident
  const incidentMap = new Map();
  for (const item of evidence) {
    if (!incidentMap.has(item.incidentId)) {
      incidentMap.set(item.incidentId, {
        id: item.incidentId,
        title: item.title ?? "Unnamed Incident",
        company: item.company ?? null,
        date: item.date ?? null,
        sections: [],
      });
    }
    incidentMap.get(item.incidentId).sections.push(item);
  }

  const incidents = [...incidentMap.values()];
  if (incidents.length < 2) {
    return { answer: null, comparisonTable: [], hasComparison: false };
  }

  // Build comparison table: one row per incident, columns = impact/rootcause/fix
  const comparisonTable = incidents.map((incident) => {
    const getSection = (type) => {
      const sec = incident.sections
        .filter((s) => s.sectionType === type)
        .sort((a, b) => b.retrievalScore - a.retrievalScore)[0];
      return sec ? sec.text.slice(0, 200) : null;
    };

    return {
      incidentId: incident.id,
      title: incident.title,
      company: incident.company,
      date: incident.date,
      impact: getSection("impact"),
      rootcause: getSection("rootcause"),
      fix: getSection("fix"),
    };
  });

  // Build a prose comparison answer with citations
  const citationBySection = new Map(citations.map((c) => [c.sectionId, c.label]));

  const dimensionLines = [];

  // Check if question focuses on a specific dimension
  const q = question.toLowerCase();
  const wantsCause = /\b(cause|why|root cause)\b/.test(q);
  const wantsFix = /\b(fix|resolve|remediation|solution)\b/.test(q);
  const wantImpact = /\b(impact|affect|outage|downtime)\b/.test(q);

  const dims = wantsCause
    ? ["rootcause"]
    : wantsFix
      ? ["fix"]
      : wantImpact
        ? ["impact"]
        : ["impact", "rootcause", "fix"];

  for (const dim of dims) {
    const dimLabel =
      dim === "rootcause" ? "Root Cause" : dim.charAt(0).toUpperCase() + dim.slice(1);
    const parts = [];

    for (const incident of incidents) {
      const sec = incident.sections
        .filter((s) => s.sectionType === dim)
        .sort((a, b) => b.retrievalScore - a.retrievalScore)[0];

      if (!sec) continue;

      const citLabel = citationBySection.get(sec.sectionId) ?? null;
      const excerpt = sec.text.slice(0, 200).replace(/\s+/g, " ").trim();
      const truncated = excerpt.length < sec.text.length ? `${excerpt}...` : excerpt;
      const companyTag = incident.company ? ` (${incident.company})` : "";
      const cite = citLabel ? ` [${citLabel}]` : "";
      parts.push(`**${incident.title}**${companyTag}: ${truncated}${cite}.`);
    }

    if (parts.length >= 2) {
      dimensionLines.push(`${dimLabel}: ${parts.join(" vs. ")}`);
    }
  }

  if (dimensionLines.length === 0) {
    return { answer: null, comparisonTable, hasComparison: false };
  }

  const answer = dimensionLines.join(" ");
  return { answer, comparisonTable, hasComparison: true };
}

/**
 * Score how many fact-type keywords a question contains.
 * Used by the eval harness to categorize evaluation queries.
 *
 * @param {string} question
 * @returns {{ factType: string | null, isComparison: boolean }}
 */
export function classifyQuestion(question) {
  return {
    factType: detectFactType(question)?.type ?? null,
    isComparison: isComparisonQuestion(question),
  };
}
