/**
 * W2-003 — Retrieval foundation unit tests
 *
 * Covers:
 *   1. NLP embedding helpers (createEmbedding, formatEmbeddingForSql, cosineSimilarity)
 *   2. Worker safeIndexIncidentEmbeddings — success path, failure graceful degradation
 *   3. Backfill / reindex logic (buildIncidentEmbeddingText, deterministic output)
 *
 * No DB or Redis required — all DB calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createEmbedding,
  formatEmbeddingForSql,
  cosineSimilarity,
  EMBEDDING_DIMENSIONS,
  tokenizeForRetrieval,
} from "@pkg/nlp";

// ── 1. NLP embedding helpers ──────────────────────────────────────────────────

describe("createEmbedding", () => {
  it("returns a 1536-d normalized array for non-empty text", () => {
    const vec = createEmbedding("database outage redis connection pool");
    expect(Array.isArray(vec)).toBe(true);
    expect(vec).toHaveLength(EMBEDDING_DIMENSIONS);

    // All values finite
    expect(vec.every(Number.isFinite)).toBe(true);

    // Unit vector: magnitude ≈ 1
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1, 3);
  });

  it("returns null for empty string", () => {
    expect(createEmbedding("")).toBeNull();
  });

  it("returns null for whitespace-only text", () => {
    expect(createEmbedding("   \n\t  ")).toBeNull();
  });

  it("returns null for text with only stopwords", () => {
    // all words in the stoplist → tokenizeForRetrieval returns []
    expect(createEmbedding("the a an is of")).toBeNull();
  });

  it("is deterministic — same text produces identical vector", () => {
    const text = "Deploy rollback caused cascading database failures";
    const v1 = createEmbedding(text);
    const v2 = createEmbedding(text);
    expect(v1).toEqual(v2);
  });

  it("produces different vectors for different text", () => {
    const v1 = createEmbedding("redis connection pool exhausted");
    const v2 = createEmbedding("kubernetes pod eviction oom kill");
    expect(v1).not.toEqual(v2);
  });

  it("respects custom dimensions", () => {
    const vec = createEmbedding("test incident outage", 384);
    expect(vec).toHaveLength(384);
  });
});

describe("formatEmbeddingForSql", () => {
  it("formats a short vector into pgvector literal syntax", () => {
    const result = formatEmbeddingForSql([0.1, -0.5, 0.3]);
    expect(result).toBe("[0.1,-0.5,0.3]");
  });

  it("returns null for null input", () => {
    expect(formatEmbeddingForSql(null)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(formatEmbeddingForSql([])).toBeNull();
  });

  it("round-trips through a real createEmbedding result", () => {
    const vec = createEmbedding("outage detection latency spike");
    const sql = formatEmbeddingForSql(vec);
    expect(typeof sql).toBe("string");
    expect(sql.startsWith("[")).toBe(true);
    expect(sql.endsWith("]")).toBe(true);
    expect(sql.split(",")).toHaveLength(EMBEDDING_DIMENSIONS);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = createEmbedding("same text same text");
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("returns a higher score for semantically similar texts", () => {
    const v1 = createEmbedding("redis connection failure timeout");
    const v2 = createEmbedding("redis connection pool error timeout");
    const v3 = createEmbedding("kubernetes cpu throttling pod eviction");

    const simRelated = cosineSimilarity(v1, v2);
    const simUnrelated = cosineSimilarity(v1, v3);

    expect(simRelated).toBeGreaterThan(simUnrelated);
  });

  it("returns 0 for null inputs", () => {
    expect(cosineSimilarity(null, null)).toBe(0);
    expect(cosineSimilarity(createEmbedding("text"), null)).toBe(0);
  });

  it("returns 0 for mismatched-length vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });
});

// ── 2. Worker embedding integration (safeIndexIncidentEmbeddings) ─────────────

describe("safeIndexIncidentEmbeddings (worker)", () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    };
  });

  it("writes incident + section embeddings when text is non-empty", async () => {
    const { safeIndexIncidentEmbeddings } = await import(
      "../retrieval.js"
    );

    const incident = {
      id: "inc-001",
      title: "Database Outage",
      company: "Acme",
      severity: "SEV-1",
      tags: ["database"],
      products: ["API"],
      summaryText: "Redis connection pool was exhausted.",
      sections: [
        { id: "sec-001", type: "impact", text: "All writes failed for 20 min." },
        { id: "sec-002", type: "fix", text: "Rolled back deploy and flushed Redis." },
      ],
    };

    const result = await safeIndexIncidentEmbeddings(mockClient, incident);

    expect(result).toBe(true);
    // 1 incident update + 2 section updates
    expect(mockClient.$executeRawUnsafe).toHaveBeenCalledTimes(3);

    // Verify incident embedding SQL
    const [incidentSql, incidentVector, incidentId] =
      mockClient.$executeRawUnsafe.mock.calls[0];
    expect(incidentSql).toContain("incidents");
    expect(incidentSql).toContain("summary_embedding");
    expect(typeof incidentVector).toBe("string");
    expect(incidentVector.startsWith("[")).toBe(true);
    expect(incidentId).toBe("inc-001");
  });

  it("gracefully skips and returns false when DB throws", async () => {
    const { safeIndexIncidentEmbeddings } = await import(
      "@pkg/db"
    );

    mockClient.$executeRawUnsafe.mockRejectedValue(
      new Error("relation does not exist")
    );

    const incident = {
      id: "inc-002",
      title: "Storage Failure",
      sections: [{ id: "sec-003", type: "rootcause", text: "NFS mount unmounted." }],
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await safeIndexIncidentEmbeddings(mockClient, incident);

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("embedding index skipped"),
      expect.stringContaining("relation does not exist")
    );
    warnSpy.mockRestore();
  });

  it("does not write embedding when incident text produces null vector (empty title/text)", async () => {
    const { safeIndexIncidentEmbeddings } = await import(
      "@pkg/db"
    );

    // All fields are empty/stopwords → createEmbedding returns null
    const incident = {
      id: "inc-003",
      title: "",
      company: null,
      severity: null,
      tags: [],
      products: [],
      summaryText: null,
      sections: [],
    };

    const result = await safeIndexIncidentEmbeddings(mockClient, incident);

    // Shouldn't crash, returns true (no writes needed)
    expect(result).toBe(true);
    expect(mockClient.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});

// ── 3. Backfill / reindex logic ────────────────────────────────────────────────

describe("Backfill embedding text builder (determinism + coverage)", () => {
  // Inline the same builder as reindex.js and retrieval.js to verify contract.
  function buildIncidentEmbeddingText(incident) {
    return [
      incident.title,
      incident.company,
      incident.severity,
      ...(incident.tags ?? []),
      ...(incident.products ?? []),
      incident.summaryText,
      ...(incident.sections ?? []).map((s) => `${s.type} ${s.text}`),
    ]
      .filter(Boolean)
      .join("\n");
  }

  it("includes all metadata fields in the embedding text", () => {
    const incident = {
      title: "Redis OOM",
      company: "Stripe",
      severity: "SEV-2",
      tags: ["redis", "memory"],
      products: ["Payments API"],
      summaryText: "Redis ran out of memory under write spike.",
      sections: [{ type: "rootcause", text: "AOF rewrite triggered under high load." }],
    };

    const text = buildIncidentEmbeddingText(incident);
    expect(text).toContain("Redis OOM");
    expect(text).toContain("Stripe");
    expect(text).toContain("SEV-2");
    expect(text).toContain("redis");
    expect(text).toContain("Payments API");
    expect(text).toContain("rootcause");
    expect(text).toContain("AOF rewrite");
  });

  it("is deterministic — same incident → same embedding", () => {
    const incident = {
      title: "Database Failover",
      company: "Acme",
      severity: "SEV-1",
      tags: ["db"],
      products: ["Core API"],
      summaryText: "Primary DB failed over.",
      sections: [{ type: "fix", text: "Promoted replica to primary." }],
    };

    const text1 = buildIncidentEmbeddingText(incident);
    const text2 = buildIncidentEmbeddingText(incident);
    expect(text1).toBe(text2);
    expect(createEmbedding(text1)).toEqual(createEmbedding(text2));
  });

  it("handles incidents with no sections (Sprint 1 data)", () => {
    const incident = {
      title: "Old Incident",
      company: null,
      severity: null,
      tags: [],
      products: [],
      summaryText: "Something went wrong.",
      sections: [],
    };

    const text = buildIncidentEmbeddingText(incident);
    expect(text).toContain("Old Incident");
    expect(text).toContain("Something went wrong.");
    // No crash, no empty line between nulls
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
  });

  it("embedding of backfill text is a valid normalized vector", () => {
    const incident = {
      title: "CDN Edge Cache Failure",
      company: "CloudFront",
      severity: "SEV-3",
      tags: ["cdn", "cache"],
      products: ["Static Assets"],
      summaryText: "Edge nodes served stale responses for 8 minutes.",
      sections: [
        { type: "impact", text: "Static assets were 8 min stale." },
        { type: "rootcause", text: "Config push overwrote TTL to 0." },
      ],
    };

    const vec = createEmbedding(buildIncidentEmbeddingText(incident));
    expect(vec).not.toBeNull();
    expect(vec).toHaveLength(EMBEDDING_DIMENSIONS);

    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1, 3);
  });
});

// ── 4. Migration schema contract ──────────────────────────────────────────────

describe("Sprint 2 migration SQL contract (static validation)", () => {
  it("createEmbedding output has exactly EMBEDDING_DIMENSIONS values", () => {
    // This test validates the dimension matches what the migration declares:
    // ALTER TABLE incidents ADD COLUMN summary_embedding vector(1536)
    const vec = createEmbedding("database connection pool exhausted timeout");
    expect(vec).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
  });

  it("formatEmbeddingForSql produces a string parseable back to 1536 floats", () => {
    const vec = createEmbedding("kubernetes node eviction oom kill pod");
    const sql = formatEmbeddingForSql(vec);

    // Strip brackets and parse
    const values = sql.slice(1, -1).split(",").map(Number);
    expect(values).toHaveLength(1536);
    expect(values.every(Number.isFinite)).toBe(true);
  });
});
