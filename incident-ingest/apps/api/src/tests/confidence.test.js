/**
 * Unit tests for QA confidence scoring — offline, DB-free.
 *
 * Guards the recalibration that replaced the old topScore/(topScore+1) squash
 * (which capped every answer near 0.5). Checks that:
 *  - strong, corroborated evidence lands in the "high" tier
 *  - a single weak hit stays "low"
 *  - confidence is monotonic in the top retrieval score
 *  - empty evidence is 0 / "low"
 */

import { describe, it, expect } from "vitest";
import { calculateConfidence, confidenceTier } from "../lib/qa.js";

const chunk = (retrievalScore) => ({ retrievalScore });

describe("calculateConfidence", () => {
  it("returns 0 for no evidence", () => {
    expect(calculateConfidence([])).toBe(0);
  });

  it("no longer caps strong answers near 0.5 (the old squash bug)", () => {
    // A strong, corroborated answer must clear 0.7 so it reads as High.
    const strong = calculateConfidence([chunk(0.85), chunk(0.7), chunk(0.6)]);
    expect(strong).toBeGreaterThanOrEqual(0.7);
  });

  it("keeps a single weak hit low", () => {
    expect(calculateConfidence([chunk(0.28)])).toBeLessThan(0.45);
  });

  it("is monotonic in the top score", () => {
    const low = calculateConfidence([chunk(0.3)]);
    const high = calculateConfidence([chunk(0.8)]);
    expect(high).toBeGreaterThan(low);
  });

  it("rewards corroborating evidence", () => {
    const single = calculateConfidence([chunk(0.6)]);
    const corroborated = calculateConfidence([chunk(0.6), chunk(0.6), chunk(0.6)]);
    expect(corroborated).toBeGreaterThan(single);
  });

  it("never exceeds the 0.98 ceiling", () => {
    const maxed = calculateConfidence(Array.from({ length: 8 }, () => chunk(1)));
    expect(maxed).toBeLessThanOrEqual(0.98);
  });
});

describe("confidenceTier", () => {
  it("maps scores to High/Medium/Low bands", () => {
    expect(confidenceTier(0.9)).toBe("high");
    expect(confidenceTier(0.7)).toBe("high");
    expect(confidenceTier(0.55)).toBe("medium");
    expect(confidenceTier(0.45)).toBe("medium");
    expect(confidenceTier(0.3)).toBe("low");
    expect(confidenceTier(0)).toBe("low");
  });
});
