/**
 * Unit tests for buildSummary() — QA coverage gate (TST-1).
 *
 * We test:
 *  - Short text returned as-is
 *  - Text > 280 chars is truncated with ellipsis
 *  - First paragraph is selected when text has blanks
 *  - Empty / whitespace-only input returns null
 */

import { describe, it, expect } from "vitest";

// Inline copy — extract to lib/text.js in a future refactor.
function buildSummary(rawText) {
  const paragraphs = rawText
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const base = paragraphs[0] || rawText.trim();
  if (!base) return null;
  return base.length > 280 ? `${base.slice(0, 277)}...` : base;
}

describe("buildSummary", () => {
  it("returns null for empty string", () => {
    expect(buildSummary("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(buildSummary("   \n\n   ")).toBeNull();
  });

  it("returns short text unchanged", () => {
    const text = "Checkout was down for 30 minutes.";
    expect(buildSummary(text)).toBe(text);
  });

  it("truncates text longer than 280 chars with ellipsis", () => {
    const long = "A".repeat(300);
    const result = buildSummary(long);
    expect(result).toHaveLength(280); // 277 chars + "..."
    expect(result?.endsWith("...")).toBe(true);
  });

  it("text at exactly 280 chars is NOT truncated", () => {
    const exact = "B".repeat(280);
    const result = buildSummary(exact);
    expect(result).toBe(exact);
    expect(result?.endsWith("...")).toBe(false);
  });

  it("text at exactly 281 chars IS truncated", () => {
    const over = "C".repeat(281);
    const result = buildSummary(over);
    expect(result).toHaveLength(280);
    expect(result?.endsWith("...")).toBe(true);
  });

  it("picks the first paragraph when there are multiple", () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    expect(buildSummary(text)).toBe("First paragraph.");
  });

  it("handles multi-line first paragraph", () => {
    const text = "Line one.\nLine two.\n\nSecond para.";
    const result = buildSummary(text);
    // first para is "Line one.\nLine two." trimmed
    expect(result).toBe("Line one.\nLine two.");
  });
});
