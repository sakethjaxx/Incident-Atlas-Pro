/**
 * @pkg/nlp — retrieval chunking
 *
 * Splits incident sections into retrieval chunks while preserving exact
 * citation anchors: every chunk carries the incidentId + sectionId it came
 * from, so answers can always cite the precise source section.
 *
 * Strategy:
 *   • One "section" chunk per section (the full section text, capped).
 *   • Additional "paragraph" chunks when a section is long enough to split —
 *     paragraphs are merged greedily up to MAX_CHUNK_CHARS with a small
 *     overlap so boundary sentences aren't lost.
 *
 * Pure functions — no DB, no model calls.
 */

export const CHUNKING = Object.freeze({
  /** Target max characters per paragraph chunk. */
  MAX_CHUNK_CHARS: 700,
  /** Characters of trailing context carried into the next chunk. */
  OVERLAP_CHARS: 80,
  /** Sections shorter than this don't get paragraph chunks (section chunk suffices). */
  MIN_SPLIT_CHARS: 900,
  /** Hard cap for the per-section "section" chunk text. */
  SECTION_CHUNK_CAP: 2_000,
});

function normalizeWhitespace(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").trim();
}

function splitParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitSentences(text) {
  return (text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Split one block of text into chunks of at most maxChars, merging small
 * paragraphs and splitting oversized ones on sentence boundaries.
 *
 * @param {string} text
 * @param {{ maxChars?: number, overlap?: number }} [opts]
 * @returns {string[]}
 */
export function chunkText(text, opts = {}) {
  const maxChars = opts.maxChars ?? CHUNKING.MAX_CHUNK_CHARS;
  const overlap = opts.overlap ?? CHUNKING.OVERLAP_CHARS;
  const clean = normalizeWhitespace(text);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  // Flatten paragraphs into units no larger than maxChars.
  const units = [];
  for (const paragraph of splitParagraphs(clean)) {
    if (paragraph.length <= maxChars) {
      units.push(paragraph);
      continue;
    }
    let current = "";
    for (const sentence of splitSentences(paragraph)) {
      if (current && current.length + sentence.length + 1 > maxChars) {
        units.push(current);
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }
    if (current) units.push(current);
  }

  // Greedy merge of units up to maxChars, with overlap carried between chunks.
  const chunks = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + unit.length + 1 > maxChars) {
      chunks.push(current);
      const tail = current.slice(Math.max(0, current.length - overlap));
      current = overlap > 0 ? `${tail} ${unit}`.trim() : unit;
    } else {
      current = current ? `${current}\n${unit}` : unit;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Build the full chunk set for an incident.
 *
 * @param {{
 *   id: string, title?: string, company?: string, severity?: string,
 *   tags?: string[], products?: string[], summaryText?: string,
 *   sections?: Array<{ id: string, type: string, text: string }>
 * }} incident
 * @returns {Array<{
 *   incidentId: string, sectionId: string, sectionType: string,
 *   chunkType: "section" | "paragraph", chunkIndex: number, text: string
 * }>}
 */
export function buildChunksForIncident(incident) {
  const chunks = [];
  for (const section of incident.sections ?? []) {
    if (!section?.id || !section?.text?.trim()) continue;
    const clean = normalizeWhitespace(section.text);

    chunks.push({
      incidentId: incident.id,
      sectionId: section.id,
      sectionType: section.type,
      chunkType: "section",
      chunkIndex: 0,
      text: clean.slice(0, CHUNKING.SECTION_CHUNK_CAP),
    });

    if (clean.length >= CHUNKING.MIN_SPLIT_CHARS) {
      chunkText(clean).forEach((text, index) => {
        chunks.push({
          incidentId: incident.id,
          sectionId: section.id,
          sectionType: section.type,
          chunkType: "paragraph",
          chunkIndex: index + 1,
          text,
        });
      });
    }
  }
  return chunks;
}

/**
 * Text used to embed a chunk: section type prefixed for a little task signal,
 * plus incident metadata so company/service names are searchable.
 *
 * @param {{ sectionType: string, text: string }} chunk
 * @param {{ title?: string, company?: string }} [incidentMeta]
 */
export function buildChunkEmbeddingText(chunk, incidentMeta = {}) {
  return [incidentMeta.title, incidentMeta.company, chunk.sectionType, chunk.text]
    .filter(Boolean)
    .join("\n");
}
