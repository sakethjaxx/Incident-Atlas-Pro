/**
 * Unit tests for the worker processor — parse logic from @pkg/nlp.
 * No Redis or Postgres needed.
 *
 * The processParseJob function is integration-tested via the
 * ingest_manual.test.js suite in apps/api (which hits a real DB).
 */

import { describe, it, expect } from "vitest";
import { parseSections, summarize } from "@pkg/nlp";

describe("summarize (via @pkg/nlp)", () => {
  it("returns null for empty string", () => {
    expect(summarize("")).toBeNull();
    expect(summarize("   ")).toBeNull();
  });

  it("returns the first paragraph", () => {
    expect(summarize("First.\n\nSecond.")).toBe("First.");
  });

  it("truncates at 280 chars with ellipsis", () => {
    const r = summarize("x".repeat(400));
    expect(r?.length).toBe(280);
    expect(r?.endsWith("...")).toBe(true);
  });
});

describe("parseSections (via @pkg/nlp)", () => {
  it("returns [] for empty input", () => {
    expect(parseSections("")).toEqual([]);
  });

  it("splits on labeled headings", () => {
    const text = `Impact\nAPI down.\n\nRoot Cause\nDeploy bug.\n\nFix\nRolled back.`;
    const s = parseSections(text);
    expect(s.map((x) => x.type)).toEqual(
      expect.arrayContaining(["impact", "rootcause", "fix"])
    );
  });

  it("handles mitigation alias", () => {
    const s = parseSections("Mitigation\nAdded CB.");
    expect(s[0].type).toBe("fix");
  });

  it("collects all content as one impact section when no headings", () => {
    const s = parseSections("Just some text.\n\nAnother para.");
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe("impact");
  });

  it("strips trailing colon from heading", () => {
    const s = parseSections("Timeline:\nT+0 deploy");
    expect(s[0].type).toBe("timeline");
  });
});
