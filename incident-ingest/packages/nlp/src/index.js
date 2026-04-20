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
