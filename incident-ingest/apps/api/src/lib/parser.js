/**
 * Known section heading labels mapped to canonical SectionType enum values.
 * Matching is case-insensitive, trims trailing colons.
 */
const SECTION_TYPES = ["impact", "timeline", "rootcause", "fix"];

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

const labelToType = new Map();
Object.entries(LABELS).forEach(([type, labels]) => {
  labels.forEach((label) => labelToType.set(label, type));
});

/**
 * Normalise a heading line for lookup: trim, lowercase, strip trailing colon.
 * @param {string} line
 * @returns {string}
 */
export function normalizeLabel(line) {
  return line.trim().replace(/:$/, "").toLowerCase();
}

/**
 * Build a plain-text summary from the first non-empty paragraph.
 * Capped at 280 characters.
 * @param {string} rawText
 * @returns {string|null}
 */
export function buildSummary(rawText) {
  const paragraphs = rawText
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const base = paragraphs[0] || rawText.trim();
  if (!base) return null;
  return base.length > 280 ? `${base.slice(0, 277)}...` : base;
}

/**
 * Split raw incident text into typed sections.
 *
 * The function recognises heading lines from LABELS and uses them as
 * delimiters. Each block of text following a heading becomes a section of the
 * corresponding type. If no headings are found the text is split by blank
 * lines and each paragraph is assigned a type from SECTION_TYPES in order.
 *
 * @param {string} rawText
 * @returns {Array<{type: string, text: string}>}
 */
export function splitSections(rawText) {
  if (!rawText || !rawText.trim()) {
    return [];
  }

  const lines = rawText.split(/\r?\n/);
  const sections = [];
  let currentType = null;
  let buffer = [];

  const pushSection = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (!text) return;
    sections.push({ type: currentType || "impact", text });
  };

  for (const line of lines) {
    const label = normalizeLabel(line);
    if (labelToType.has(label)) {
      // Flush previous buffer before switching section type
      if (currentType !== null || buffer.some((l) => l.trim())) {
        pushSection();
      }
      currentType = labelToType.get(label);
      continue;
    }
    buffer.push(line);
  }
  pushSection();

  // Fallback: no headings found — split on blank lines and assign types by position
  if (sections.length === 0) {
    const chunks = rawText
      .split(/\n\s*\n/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    if (chunks.length === 0) {
      return [{ type: "impact", text: rawText.trim() }];
    }
    return chunks.map((text, index) => ({
      type: SECTION_TYPES[Math.min(index, SECTION_TYPES.length - 1)],
      text,
    }));
  }

  return sections;
}
