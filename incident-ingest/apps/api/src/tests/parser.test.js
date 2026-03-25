import { describe, it, expect } from "vitest";
import { splitSections, buildSummary, normalizeLabel } from "../lib/parser.js";

// ─── normalizeLabel ──────────────────────────────────────────────────────────
describe("normalizeLabel", () => {
  it("lowercases and trims", () => {
    expect(normalizeLabel("  Impact  ")).toBe("impact");
  });

  it("strips trailing colon", () => {
    expect(normalizeLabel("Root Cause:")).toBe("root cause");
  });

  it("handles already-clean labels", () => {
    expect(normalizeLabel("fix")).toBe("fix");
  });
});

// ─── buildSummary ────────────────────────────────────────────────────────────
describe("buildSummary", () => {
  it("returns null for empty string", () => {
    expect(buildSummary("")).toBeNull();
    expect(buildSummary("   ")).toBeNull();
  });

  it("returns the first paragraph", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    expect(buildSummary(text)).toBe("First paragraph.");
  });

  it("truncates to 280 chars and appends ...", () => {
    const longLine = "x".repeat(400);
    const result = buildSummary(longLine);
    expect(result?.length).toBe(280);
    expect(result?.endsWith("...")).toBe(true);
  });

  it("does not truncate short text", () => {
    const text = "Short incident description.";
    expect(buildSummary(text)).toBe(text);
  });
});

// ─── splitSections ───────────────────────────────────────────────────────────
describe("splitSections", () => {
  it("returns empty array for empty input", () => {
    expect(splitSections("")).toEqual([]);
    expect(splitSections("   ")).toEqual([]);
  });

  it("wraps single block in impact section", () => {
    const result = splitSections("Something went wrong.");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("impact");
    expect(result[0].text).toContain("Something went wrong.");
  });

  it("splits on known section headings", () => {
    const text = `Impact\nThe API was down.\n\nRoot Cause\nA bad deploy.\n\nFix\nRolled back.`;
    const sections = splitSections(text);
    const types = sections.map((s) => s.type);
    expect(types).toContain("impact");
    expect(types).toContain("rootcause");
    expect(types).toContain("fix");
  });

  it("handles heading with trailing colon", () => {
    const text = `Timeline:\n09:00 Deploy\n09:15 Alerts`;
    const sections = splitSections(text);
    expect(sections[0].type).toBe("timeline");
  });

  it("collects all content as a single impact section when no headings present", () => {
    // No headings → entire text collected as one buffer, flushed as impact
    const text = `First block.\n\nSecond block.\n\nThird block.\n\nFourth block.`;
    const sections = splitSections(text);
    expect(sections.length).toBe(1);
    expect(sections[0].type).toBe("impact");
    // All paragraphs joined
    expect(sections[0].text).toContain("First block.");
    expect(sections[0].text).toContain("Fourth block.");
  });

  it("ignores empty buffers between headings", () => {
    const text = `Impact\n\nFix\nRolled back to v1.`;
    const sections = splitSections(text);
    const fixSection = sections.find((s) => s.type === "fix");
    expect(fixSection).toBeDefined();
    expect(fixSection?.text).toContain("Rolled back");
  });

  it("handles mitigation alias for fix", () => {
    const text = `Mitigation\nAdded circuit breaker.`;
    const sections = splitSections(text);
    expect(sections[0].type).toBe("fix");
  });

  it("handles customer impact alias", () => {
    const text = `Customer Impact\n5% of users affected.`;
    const sections = splitSections(text);
    expect(sections[0].type).toBe("impact");
  });

  it("handles unicode content without crashing", () => {
    const text = `Impact\n日本語のインシデント説明\n\nFix\n解決策: デプロイをロールバック`;
    const sections = splitSections(text);
    expect(sections.length).toBeGreaterThan(0);
  });
});
