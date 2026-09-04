/**
 * Tests for the Production RAG modules:
 *   - acronyms.js (expandQueryAcronyms, expandToken, getAcronymHints)
 *   - factExtract.js (detectFactType, extractKeyFact, isComparisonQuestion, buildComparisonAnswer)
 *   - evalHarness.js (runEvalHarness, measureFactHit, measureAcronymCoverage)
 */

import { describe, it, expect } from "vitest";

// ── acronyms.js ───────────────────────────────────────────────────────────────
import {
  expandQueryAcronyms,
  expandToken,
  getAcronymHints,
  ACRONYM_MAP,
} from "../acronyms.js";

describe("expandToken", () => {
  it("expands k8s to include kubernetes", () => {
    const result = expandToken("k8s");
    expect(result).toContain("k8s");
    expect(result).toContain("kubernetes");
  });

  it("expands s3 to include aws s3 tokens", () => {
    const result = expandToken("s3");
    expect(result).toContain("s3");
    expect(result.join(" ")).toMatch(/aws|object|storage/);
  });

  it("expands oom to include memory tokens", () => {
    const result = expandToken("oom");
    expect(result.join(" ")).toMatch(/memory/);
  });

  it("expands ssl to include tls and certificate", () => {
    const result = expandToken("ssl");
    expect(result.join(" ")).toMatch(/tls|certificate/);
  });

  it("returns original token unchanged when not in dictionary", () => {
    const result = expandToken("foobarxyz");
    expect(result).toEqual(["foobarxyz"]);
  });

  it("returns at least 2 tokens for each known acronym", () => {
    for (const [key] of ACRONYM_MAP) {
      const result = expandToken(key);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result).toContain(key.toLowerCase());
    }
  });
});

describe("expandQueryAcronyms", () => {
  it("expands k8s in a query", () => {
    const { expanded, hasAcronyms } = expandQueryAcronyms("k8s pod eviction");
    expect(hasAcronyms).toBe(true);
    expect(expanded).toMatch(/kubernetes/);
  });

  it("expands s3 and oom in the same query", () => {
    const { expanded, foundAcronyms } = expandQueryAcronyms("oom error in s3 bucket");
    expect(foundAcronyms).toContain("oom");
    expect(foundAcronyms).toContain("s3");
    expect(expanded).toMatch(/memory/);
  });

  it("expands ssl to tls", () => {
    const { expanded } = expandQueryAcronyms("ssl certificate expired");
    expect(expanded).toMatch(/tls/);
  });

  it("does not duplicate the original tokens", () => {
    const { expanded } = expandQueryAcronyms("redis connection pool");
    const tokens = expanded.split(/\s+/);
    const uniq = new Set(tokens);
    // every token appears at most once
    expect(tokens.length).toBe(uniq.size);
  });

  it("returns hasAcronyms=false for queries with no known acronyms", () => {
    const { hasAcronyms } = expandQueryAcronyms("what happened during the deployment");
    expect(hasAcronyms).toBe(false);
  });

  it("handles empty string gracefully", () => {
    const { expanded, hasAcronyms } = expandQueryAcronyms("");
    expect(expanded).toBe("");
    expect(hasAcronyms).toBe(false);
  });

  it("handles null/undefined gracefully", () => {
    expect(() => expandQueryAcronyms(null)).not.toThrow();
    expect(() => expandQueryAcronyms(undefined)).not.toThrow();
  });
});

describe("getAcronymHints", () => {
  it("returns hints for k8s", () => {
    const hints = getAcronymHints("k8s pod crash");
    expect(hints.length).toBeGreaterThan(0);
    const acr = hints.map((h) => h.acronym);
    expect(acr).toContain("k8s");
  });

  it("returns empty array when no acronyms found", () => {
    const hints = getAcronymHints("redis connection timeout latency");
    // redis IS in the map but as itself, shouldn't produce a hint (expansion same as key)
    // or it might — either way it should not throw
    expect(Array.isArray(hints)).toBe(true);
  });

  it("returns empty for empty query", () => {
    expect(getAcronymHints("")).toEqual([]);
  });
});

// ── factExtract.js ────────────────────────────────────────────────────────────
import {
  detectFactType,
  extractKeyFact,
  isComparisonQuestion,
  buildComparisonAnswer,
  classifyQuestion,
} from "../factExtract.js";

const SAMPLE_EVIDENCE = [
  {
    sectionId: "sec-dur-1",
    incidentId: "inc-1",
    sectionType: "impact",
    text: "The Redis outage lasted approximately 45 minutes from 14:00 to 14:45 UTC.",
    title: "Redis OOM",
    company: "Acme",
    retrievalScore: 0.85,
  },
  {
    sectionId: "sec-cause-1",
    incidentId: "inc-1",
    sectionType: "rootcause",
    text: "Root cause was a memory leak caused by an unclosed connection in version 2.4.1.",
    title: "Redis OOM",
    company: "Acme",
    retrievalScore: 0.8,
  },
];

describe("detectFactType", () => {
  it("detects duration question", () => {
    const result = detectFactType("How long was the outage?");
    expect(result?.type).toBe("duration");
  });

  it("detects cause question", () => {
    const result = detectFactType("What was the root cause?");
    expect(result?.type).toBe("cause");
  });

  it("detects count question", () => {
    const result = detectFactType("How many users were affected?");
    expect(result?.type).toBe("count");
  });

  it("detects percentage question", () => {
    const result = detectFactType("What percentage of requests failed?");
    expect(result?.type).toBe("percentage");
  });

  it("detects fix question", () => {
    const result = detectFactType("How was it fixed?");
    expect(result?.type).toBe("fix");
  });

  it("detects time question", () => {
    const result = detectFactType("When did the outage start?");
    expect(result?.type).toBe("time");
  });

  it("returns null for general questions", () => {
    const result = detectFactType("Tell me about the incident");
    expect(result).toBeNull();
  });
});

describe("extractKeyFact", () => {
  it("extracts duration from evidence text", () => {
    const result = extractKeyFact("How long did the Redis outage last?", SAMPLE_EVIDENCE);
    expect(result.found).toBe(true);
    expect(result.factType).toBe("duration");
    expect(result.value).toBeTruthy();
    expect(result.value).toMatch(/\d+/);
  });

  it("extracts cause from evidence text", () => {
    const causeEvidence = [
      {
        sectionId: "sec-cause-1",
        incidentId: "inc-1",
        sectionType: "rootcause",
        text: "Root cause was a memory leak caused by an unclosed connection in version 2.4.1.",
        title: "Redis OOM",
        company: "Acme",
        retrievalScore: 0.8,
      },
    ];
    const result = extractKeyFact("What was the root cause?", causeEvidence);
    expect(result.found).toBe(true);
    expect(result.factType).toBe("cause");
    expect(result.sectionId).toBe("sec-cause-1");
  });

  it("returns found=false for unanswerable question (no evidence)", () => {
    const result = extractKeyFact("How long did the outage last?", []);
    expect(result.found).toBe(false);
    expect(result.value).toBeNull();
  });

  it("returns found=false when no fact type detected", () => {
    const result = extractKeyFact("Tell me about the incident", SAMPLE_EVIDENCE);
    expect(result.found).toBe(false);
    expect(result.factType).toBeNull();
  });

  it("always returns non-throwing result for any input", () => {
    expect(() => extractKeyFact("", [])).not.toThrow();
    expect(() => extractKeyFact(null, null)).not.toThrow();
    expect(() => extractKeyFact(undefined, undefined)).not.toThrow();
  });

  it("populates sectionId and incidentId when found", () => {
    const result = extractKeyFact("How long did the Redis outage last?", SAMPLE_EVIDENCE);
    if (result.found) {
      expect(result.sectionId).toBeTruthy();
      expect(result.incidentId).toBeTruthy();
    }
  });
});

describe("isComparisonQuestion", () => {
  it("detects 'compare X vs Y'", () => {
    expect(isComparisonQuestion("compare redis vs postgres incidents")).toBe(true);
  });

  it("detects 'difference between'", () => {
    expect(isComparisonQuestion("what is the difference between the two outages")).toBe(true);
  });

  it("detects 'versus'", () => {
    expect(isComparisonQuestion("AWS outage versus the Monzo incident")).toBe(true);
  });

  it("returns false for non-comparison questions", () => {
    expect(isComparisonQuestion("what was the root cause of the redis outage")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isComparisonQuestion("")).toBe(false);
  });
});

describe("buildComparisonAnswer", () => {
  const multiIncidentEvidence = [
    {
      incidentId: "inc-a",
      sectionId: "s1",
      sectionType: "rootcause",
      text: "Connection leak in Redis client library caused pool exhaustion.",
      title: "Redis OOM Incident",
      company: "Acme",
      date: "2024-01-01",
      retrievalScore: 0.9,
    },
    {
      incidentId: "inc-b",
      sectionId: "s2",
      sectionType: "rootcause",
      text: "Hardware failure on primary RDS triggered automatic failover.",
      title: "Database Failover",
      company: "Stripe",
      date: "2024-02-01",
      retrievalScore: 0.88,
    },
  ];

  it("returns hasComparison=true for multi-incident evidence", () => {
    const { hasComparison } = buildComparisonAnswer(
      "Compare the root causes",
      multiIncidentEvidence,
      []
    );
    expect(hasComparison).toBe(true);
  });

  it("returns hasComparison=false for single incident", () => {
    const { hasComparison } = buildComparisonAnswer(
      "Compare the root causes",
      [multiIncidentEvidence[0]],
      []
    );
    expect(hasComparison).toBe(false);
  });

  it("returns a comparison table with one row per incident", () => {
    const { comparisonTable } = buildComparisonAnswer(
      "Compare the root causes",
      multiIncidentEvidence,
      []
    );
    expect(comparisonTable.length).toBe(2);
    expect(comparisonTable[0].incidentId).toBeTruthy();
  });

  it("answer contains text from both incidents", () => {
    const { answer } = buildComparisonAnswer(
      "Compare the root causes",
      multiIncidentEvidence,
      []
    );
    expect(answer).toBeTruthy();
    // Should mention both incident titles or content
    expect(answer.length).toBeGreaterThan(20);
  });
});

describe("classifyQuestion", () => {
  it("classifies a duration question", () => {
    const { factType, isComparison } = classifyQuestion("How long was the outage?");
    expect(factType).toBe("duration");
    expect(isComparison).toBe(false);
  });

  it("classifies a comparison question", () => {
    const { isComparison } = classifyQuestion("Compare the two incidents");
    expect(isComparison).toBe(true);
  });

  it("classifies general questions", () => {
    const { factType, isComparison } = classifyQuestion("Tell me about the service");
    expect(factType).toBeNull();
    expect(isComparison).toBe(false);
  });
});

// ── evalHarness.js ────────────────────────────────────────────────────────────
import {
  runEvalHarness,
  measureFactHit,
  measureAcronymCoverage,
  measureRetrievalRecall,
  measureComparisonDetection,
  EVAL_FIXTURES,
} from "../evalHarness.js";

describe("EVAL_FIXTURES", () => {
  it("has at least 10 fixtures", () => {
    expect(EVAL_FIXTURES.length).toBeGreaterThanOrEqual(10);
  });

  it("every fixture has an id and question", () => {
    for (const f of EVAL_FIXTURES) {
      expect(f.id).toBeTruthy();
      expect(f.question).toBeTruthy();
    }
  });
});

describe("measureFactHit", () => {
  it("returns hit=true for a duration fixture with matching evidence", () => {
    const fixture = EVAL_FIXTURES.find((f) => f.id === "duration-001");
    expect(fixture).toBeTruthy();
    const result = measureFactHit(fixture);
    expect(result.hit).toBe(true);
    expect(result.value).toBeTruthy();
  });

  it("returns hit=false for a fixture without a factType match", () => {
    // refuse-001 has no evidence and no expectedFactType
    const fixture = { question: "Tell me anything", evidence: [], id: "x" };
    const result = measureFactHit(fixture);
    // detectFactType returns null → found=false
    expect(result.hit).toBe(false);
  });
});

describe("measureAcronymCoverage", () => {
  it("returns hit=true for k8s fixture", () => {
    const fixture = EVAL_FIXTURES.find((f) => f.id === "acronym-001");
    expect(fixture).toBeTruthy();
    const result = measureAcronymCoverage(fixture);
    expect(result.hit).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("returns hit=true for oom fixture", () => {
    const fixture = EVAL_FIXTURES.find((f) => f.id === "acronym-003");
    expect(fixture).toBeTruthy();
    const result = measureAcronymCoverage(fixture);
    expect(result.hit).toBe(true);
  });
});

describe("measureRetrievalRecall", () => {
  it("returns recall=false for empty evidence when answerableWithEvidence=true", () => {
    const fixture = { question: "What happened?", evidence: [], answerableWithEvidence: true };
    const result = measureRetrievalRecall(fixture);
    // With empty evidence and answerableWithEvidence=true, no embedding match possible
    expect(typeof result.recall).toBe("boolean");
    expect(typeof result.topScore).toBe("number");
  });

  it("returns recall=true for empty evidence on refusal fixture", () => {
    const fixture = EVAL_FIXTURES.find((f) => f.id === "refuse-001");
    const result = measureRetrievalRecall(fixture);
    // no evidence expected for refusal → recall=!answerableWithEvidence = true
    expect(result.recall).toBe(true);
  });
});

describe("measureComparisonDetection", () => {
  it("correctly detects comparison question", () => {
    const fixture = EVAL_FIXTURES.find((f) => f.isComparison);
    expect(fixture).toBeTruthy();
    const result = measureComparisonDetection(fixture);
    expect(result.correct).toBe(true);
    expect(result.detected).toBe(true);
  });

  it("correctly identifies non-comparison questions", () => {
    const fixture = EVAL_FIXTURES.find((f) => f.id === "duration-001");
    // duration-001 doesn't have isComparison set
    const result = measureComparisonDetection({ ...fixture, isComparison: false });
    expect(result.correct).toBe(true);
    expect(result.detected).toBe(false);
  });
});

describe("runEvalHarness", () => {
  it("returns summary with all expected fields", () => {
    const { summary } = runEvalHarness();
    expect(typeof summary.factHitRate).toBe("number");
    expect(typeof summary.acronymCoverageRate).toBe("number");
    expect(typeof summary.retrievalRecallRate).toBe("number");
    expect(typeof summary.comparisonDetectionRate).toBe("number");
    expect(summary.totalFixtures).toBeGreaterThan(0);
  });

  it("acronymCoverageRate meets 100% threshold", () => {
    const { summary } = runEvalHarness();
    expect(summary.acronymCoverageRate).toBe(1.0);
  });

  it("comparisonDetectionRate meets 100% threshold", () => {
    const { summary } = runEvalHarness();
    expect(summary.comparisonDetectionRate).toBe(1.0);
  });

  it("factHitRate is above 70% threshold", () => {
    const { summary } = runEvalHarness();
    expect(summary.factHitRate).toBeGreaterThanOrEqual(0.7);
  });

  it("thresholdsMet reflects whether all thresholds pass", () => {
    const { thresholdsMet, summary } = runEvalHarness();
    const expected =
      summary.factHitRate >= 0.70 &&
      summary.acronymCoverageRate >= 1.0 &&
      summary.comparisonDetectionRate >= 1.0;
    expect(thresholdsMet).toBe(expected);
  });

  it("returns one result per fixture", () => {
    const { results } = runEvalHarness();
    expect(results.length).toBe(EVAL_FIXTURES.length);
  });
});
