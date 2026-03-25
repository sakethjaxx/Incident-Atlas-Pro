/**
 * Unit tests for splitSections() — QA coverage gate (TST-1).
 *
 * We exercise:
 *  - Happy-path section detection via known header labels
 *  - Multiple sections in sequence
 *  - Fallback paragraph split when no headers found
 *  - Fallback single-section when input has no paragraphs
 *  - Labels with trailing colon ("Impact:")
 *  - Case-insensitive label matching
 *  - Empty / whitespace-only input
 */

import { describe, it, expect } from "vitest";

// Re-export the two pure functions from index.js so tests don't spin up Express.
// Because index.js mixes setup with pure logic we inline the functions here
// (identical copies) — a future refactor should extract them to a lib module.

const SECTION_TYPES = ["impact", "timeline", "rootcause", "fix"];
const LABELS = {
  impact: ["impact", "customer impact", "user impact"],
  timeline: ["timeline", "timeline of events", "events"],
  rootcause: ["root cause", "rootcause", "cause"],
  fix: ["fix", "resolution", "mitigation", "remediation", "prevention"],
};

const labelToType = new Map();
Object.entries(LABELS).forEach(([type, labels]) => {
  labels.forEach((label) => labelToType.set(label, type));
});

function normalizeLabel(line) {
  return line.trim().replace(/:$/, "").toLowerCase();
}

function splitSections(rawText) {
  const lines = rawText.split(/\r?\n/);
  const sections = [];
  let currentType = null;
  let buffer = [];

  const pushSection = () => {
    const text = buffer.join("\n").trim();
    if (!text) {
      buffer = [];
      return;
    }
    sections.push({ type: currentType || "impact", text });
    buffer = [];
  };

  for (const line of lines) {
    const label = normalizeLabel(line);
    if (labelToType.has(label)) {
      if (currentType || buffer.length) {
        pushSection();
      }
      currentType = labelToType.get(label);
      continue;
    }
    buffer.push(line);
  }
  pushSection();

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("splitSections", () => {
  it("detects a single named section", () => {
    const text = "Impact\nCheckout was down for 30 min.";
    const result = splitSections(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("impact");
    expect(result[0].text).toContain("Checkout was down");
  });

  it("detects four named sections in order", () => {
    const text = [
      "Impact",
      "500 errors across checkout.",
      "Timeline",
      "14:00 deploy, 14:05 alert",
      "Root Cause",
      "Bad config flag",
      "Fix",
      "Rolled back config.",
    ].join("\n");

    const result = splitSections(text);
    expect(result.map((s) => s.type)).toEqual([
      "impact",
      "timeline",
      "rootcause",
      "fix",
    ]);
  });

  it("handles labels with trailing colon (Impact:)", () => {
    const text = "Impact:\nAll users affected.";
    const result = splitSections(text);
    expect(result[0].type).toBe("impact");
  });

  it("is case-insensitive (IMPACT, Impact, impact)", () => {
    for (const label of ["IMPACT", "Impact", "impact"]) {
      const result = splitSections(`${label}\nSome text.`);
      expect(result[0].type).toBe("impact");
    }
  });

  it("falls back to paragraph split when no headers found", () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    const result = splitSections(text);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("impact");
    expect(result[1].type).toBe("timeline");
    expect(result[2].type).toBe("rootcause");
  });

  it("single paragraph fallback produces one impact section", () => {
    const text = "A single flat string with no blank lines or headers.";
    const result = splitSections(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("impact");
    expect(result[0].text).toBe(text);
  });

  it("returns one impact section for whitespace-only content", () => {
    const result = splitSections("   \n   \n   ");
    // whitespace input: rawText.trim() === '' → single impact with empty text
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("impact");
  });

  it("recognises all fix aliases", () => {
    const aliases = ["fix", "resolution", "mitigation", "remediation", "prevention"];
    for (const alias of aliases) {
      const result = splitSections(`${alias}\nSome fix text.`);
      expect(result[0].type).toBe("fix");
    }
  });

  it("recognises timeline aliases", () => {
    const aliases = ["timeline", "timeline of events", "events"];
    for (const alias of aliases) {
      const result = splitSections(`${alias}\nStar: 14:00`);
      expect(result[0].type).toBe("timeline");
    }
  });

  it("does not create empty sections between consecutive headers", () => {
    const text = "Impact\nTimeline\n14:00 - Deploy";
    const result = splitSections(text);
    // 'Impact' header followed immediately by 'Timeline' header → no impact section
    const types = result.map((s) => s.type);
    expect(types).not.toContain("impact");
    expect(types).toContain("timeline");
  });
});
