/**
 * @pkg/nlp — incident text parsing utilities
 *
 * Public API (stable):
 *   parseSections(rawText)           → Section[]
 *   summarize(text, maxChars?)       → string | null
 *   normalizeLabel(line)             → string        (exported for testing)
 *
 * Section shape: { type: SectionType, text: string }
 * SectionType:   "impact" | "timeline" | "rootcause" | "fix"
 *
 * Design notes
 * ────────────
 * • Zero runtime dependencies — pure Node.js ESM.
 * • parseSections uses a two-pass strategy:
 *     Pass 1: look for labelled headings (LABELS map).  If found, each heading
 *             opens a new section; content following it accumulates in a buffer
 *             until the next heading or EOF.
 *     Pass 2 (fallback): if no headings are detected, split on blank lines and
 *             assign canonical types by paragraph position (impact → timeline
 *             → rootcause → fix → fix → fix …).
 * • summarize() is the W1-005 rename of the old buildSummary().  The old name
 *   is re-exported as an alias so existing callers don't break.
 */

import crypto from "node:crypto";

// ─── Section types ────────────────────────────────────────────────────────────

/** Canonical ordered list of section types. */
export const SECTION_TYPES = Object.freeze([
  "impact",
  "timeline",
  "rootcause",
  "fix",
]);

// ─── Heading label → type mapping ─────────────────────────────────────────────

const LABELS = {
  impact: ["impact", "customer impact", "user impact", "affected"],
  timeline: ["timeline", "timeline of events", "events", "chronology"],
  rootcause: [
    "root cause",
    "rootcause",
    "cause",
    "root cause analysis",
    "rca",
  ],
  fix: [
    "fix",
    "resolution",
    "mitigation",
    "remediation",
    "prevention",
    "corrective action",
    "remediation steps",
  ],
};

/** @type {Map<string, string>} normalised label → SectionType */
const labelToType = new Map();
for (const [type, aliases] of Object.entries(LABELS)) {
  for (const alias of aliases) {
    labelToType.set(alias, type);
  }
}

// ─── normalizeLabel ───────────────────────────────────────────────────────────

/**
 * Normalise a potential heading line for map lookup.
 * Trims whitespace, lowercases, strips a single trailing colon.
 *
 * @param {string} line
 * @returns {string}
 */
export function normalizeLabel(line) {
  return line.trim().replace(/:$/, "").toLowerCase();
}

// ─── summarize ────────────────────────────────────────────────────────────────

/**
 * Build a plain-text summary from the first non-empty paragraph of `text`.
 *
 * @param {string} text        Raw incident text.
 * @param {number} [maxChars=280]  Maximum character length of the returned string.
 *                             If the first paragraph exceeds this, it is truncated
 *                             and "…" appended (3-byte ellipsis fits in one char).
 * @returns {string | null}    null when `text` is empty or whitespace-only.
 */
export function summarize(text, maxChars = 280) {
  if (typeof text !== "string" || !text.trim()) return null;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const base = paragraphs[0] || text.trim();
  if (!base) return null;
  if (base.length > maxChars) {
    if (maxChars <= 3) return base.slice(0, maxChars);
    return `${base.slice(0, maxChars - 3)}...`;
  }
  return base;
}

/** @deprecated Use `summarize()`.  Kept for backward-compat with apps/api. */
export const buildSummary = summarize;

// --- Sprint 2 retrieval helpers -------------------------------------------

export const EMBEDDING_DIMENSIONS = 1536;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "was",
  "were",
  "with",
]);

/**
 * Tokenize text for deterministic retrieval features.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeForRetrieval(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];
  return matches.filter((token) => !STOPWORDS.has(token));
}

function hashUInt32(value) {
  const digest = crypto.createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0);
}

/**
 * Create a deterministic, normalized 1536-d embedding.
 *
 * This is the offline/dev embedding path for Sprint 2. It gives stable vector
 * behavior with no network dependency and can be replaced by a model-backed
 * provider later while keeping the DB/search contract unchanged.
 *
 * @param {string} text
 * @param {number} [dimensions=EMBEDDING_DIMENSIONS]
 * @returns {number[] | null}
 */
export function createEmbedding(text, dimensions = EMBEDDING_DIMENSIONS) {
  const tokens = tokenizeForRetrieval(text);
  if (tokens.length === 0 || dimensions < 1) return null;

  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const vector = new Array(dimensions).fill(0);
  for (const [token, count] of counts.entries()) {
    const weight = 1 + Math.log(count);
    for (let seed = 0; seed < 2; seed += 1) {
      const index = hashUInt32(`${seed}:${token}`) % dimensions;
      const sign = hashUInt32(`sign:${seed}:${token}`) % 2 === 0 ? 1 : -1;
      vector[index] += sign * weight;
    }
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return null;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

/**
 * Convert an embedding array to pgvector's text literal format.
 *
 * @param {number[] | null} embedding
 * @returns {string | null}
 */
export function formatEmbeddingForSql(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  return `[${embedding.join(",")}]`;
}

/**
 * Cosine similarity for already-normalized or raw vectors.
 *
 * @param {number[] | null} left
 * @param {number[] | null} right
 * @returns {number}
 */
export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

// ─── parseSections ────────────────────────────────────────────────────────────

/**
 * Split raw incident text into typed sections.
 *
 * @param {string} rawText
 * @returns {Array<{type: string, text: string}>}
 *   Each element is `{ type: SectionType, text: string }`.
 *   Never returns null; returns [] only when rawText is empty/whitespace.
 */
export function parseSections(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];

  const lines = rawText.split(/\r?\n/);
  const sections = [];
  let currentType = null;
  let buffer = [];

  const flushBuffer = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (!text) return;
    sections.push({ type: currentType ?? "impact", text });
  };

  for (const line of lines) {
    const label = normalizeLabel(line);
    if (labelToType.has(label)) {
      // Flush accumulated content before switching to a new section type
      if (currentType !== null || buffer.some((l) => l.trim())) {
        flushBuffer();
      }
      currentType = labelToType.get(label);
      continue;
    }
    buffer.push(line);
  }
  flushBuffer();

  // Fallback: no headings detected — split on blank lines, assign by position
  if (sections.length === 0) {
    const chunks = rawText
      .split(/\n\s*\n/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (chunks.length === 0) {
      return [{ type: "impact", text: rawText.trim() }];
    }
    return chunks.map((text, i) => ({
      type: SECTION_TYPES[Math.min(i, SECTION_TYPES.length - 1)],
      text,
    }));
  }

  return sections;
}

/** @deprecated Use `parseSections()`.  Kept for backward-compat with apps/api + apps/worker. */
export const splitSections = parseSections;

// ─── Sprint 3: Graph extraction ───────────────────────────────────────────────

export {
  extractGraph,
  ruleExtractGraph,
  normalizeNodeName,
  validateNode,
  validateEdge,
  deduplicateNodes,
  VALID_NODE_TYPES,
  VALID_REL_TYPES,
} from "./graphExtract.js";

// ─── Open-source RAG stack (providers, chunking, fusion, rerank, TurboQuant) ──

export {
  STORAGE_DIMENSIONS,
  getRagConfig,
  ollamaGenerate,
  ollamaEmbed,
  embedText,
  embedTexts,
  padToStorageDimensions,
  describeEmbeddingProvider,
  resetBgePipelineForTest,
} from "./providers.js";

export {
  CHUNKING,
  chunkText,
  buildChunksForIncident,
  buildChunkEmbeddingText,
} from "./chunking.js";

export { RRF_K, rrfFuse, buildRetrievalTrace } from "./fusion.js";

export { tokenOverlapScore, rerankCandidates } from "./rerank.js";

export {
  rotateVector,
  quantizeVector,
  prepareQuery,
  approxCosine,
  scanCodes,
  unpackCodes,
  serializeQuantized,
  deserializeQuantized,
  compressedSizeBytes,
} from "./turboquant.js";
