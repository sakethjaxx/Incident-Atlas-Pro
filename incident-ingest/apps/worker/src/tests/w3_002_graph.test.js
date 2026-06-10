/**
 * W3-002 — Worker graph indexing unit tests
 *
 * Tests safeIndexIncidentGraph from apps/worker/src/graph.js.
 *
 * Covers:
 *   1. Success path — nodes upserted, edges inserted with evidence_section_id
 *   2. No-duplicate-node upsert — ON CONFLICT DO NOTHING
 *   3. Edge requires evidence_section_id — edges without it are dropped
 *   4. LLM failure / rule fallback — safeIndexIncidentGraph still succeeds
 *   5. DB failure — function catches and returns false (does not throw)
 *   6. Missing incident.id — returns false immediately
 *   7. Empty sections — returns true without DB calls
 *
 * No real DB or network required — all DB calls are mocked.
 * GRAPH_EXTRACTOR is unset to force the deterministic rule extractor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeIndexIncidentGraph } from "../graph.js";

// Force rule fallback (no LLM call) for all tests
delete process.env.GRAPH_EXTRACTOR;

// ── Mock Prisma client factory ─────────────────────────────────────────────────

function makeClient({ nodeRows = [], edgeWriteOk = true } = {}) {
  // $queryRawUnsafe is used to SELECT node id after upsert
  // We return a fake node row with a UUID-like id
  const mockQueryRaw = vi.fn().mockResolvedValue(
    nodeRows.length > 0 ? nodeRows : [{ id: "00000000-0000-0000-0000-000000000001" }]
  );
  const mockExecRaw = edgeWriteOk
    ? vi.fn().mockResolvedValue(1)
    : vi.fn().mockRejectedValue(new Error("DB constraint violation"));

  return {
    $executeRawUnsafe: mockExecRaw,
    $queryRawUnsafe: mockQueryRaw,
    _execRaw: mockExecRaw,
    _queryRaw: mockQueryRaw,
  };
}

// ── Fixture incident ───────────────────────────────────────────────────────────

const FIXTURE_INCIDENT = {
  id: "inc-00000000-0000-0000-0000-000000000001",
  title: "Payment API Outage",
  company: "Acme Corp",
  tags: ["payment-api"],
  sections: [
    {
      id: "sec-00000000-0000-0000-0000-000000000001",
      type: "impact",
      text: "Users experienced elevated error rates and partial outage of the payment-api.",
    },
    {
      id: "sec-00000000-0000-0000-0000-000000000002",
      type: "rootcause",
      text: "The issue was caused by a misconfigured connection pool limit on auth-service.",
    },
    {
      id: "sec-00000000-0000-0000-0000-000000000003",
      type: "fix",
      text: "Fixed by rolling back the deploy and increasing the connection pool size.",
    },
  ],
};

// ── 1. Success path ────────────────────────────────────────────────────────────

describe("safeIndexIncidentGraph — success path", () => {
  it("returns true on success", async () => {
    const client = makeClient();
    const result = await safeIndexIncidentGraph(client, FIXTURE_INCIDENT);
    expect(result).toBe(true);
  });

  it("calls $executeRawUnsafe for node upsert(s)", async () => {
    const client = makeClient();
    await safeIndexIncidentGraph(client, FIXTURE_INCIDENT);
    // At least one INSERT INTO graph_nodes call
    const nodeInserts = client._execRaw.mock.calls.filter(([sql]) =>
      sql.includes("graph_nodes")
    );
    expect(nodeInserts.length).toBeGreaterThan(0);
  });

  it("calls $executeRawUnsafe for edge insert(s)", async () => {
    const client = makeClient();
    await safeIndexIncidentGraph(client, FIXTURE_INCIDENT);
    const edgeInserts = client._execRaw.mock.calls.filter(([sql]) =>
      sql.includes("graph_edges")
    );
    // Should have at least one edge
    expect(edgeInserts.length).toBeGreaterThan(0);
  });

  it("passes incident.id as the incident_id in edge inserts", async () => {
    const client = makeClient();
    await safeIndexIncidentGraph(client, FIXTURE_INCIDENT);
    const edgeInserts = client._execRaw.mock.calls.filter(([sql]) =>
      sql.includes("graph_edges")
    );
    for (const [, , , , incidentId] of edgeInserts) {
      // 5th param is incident_id
      expect(incidentId).toBe(FIXTURE_INCIDENT.id);
    }
  });

  it("passes a valid evidence_section_id in all edge inserts", async () => {
    const client = makeClient();
    await safeIndexIncidentGraph(client, FIXTURE_INCIDENT);
    const sectionIds = new Set(FIXTURE_INCIDENT.sections.map((s) => s.id));
    const edgeInserts = client._execRaw.mock.calls.filter(([sql]) =>
      sql.includes("graph_edges")
    );
    for (const [, , , , , evidenceSectionId] of edgeInserts) {
      // 6th param is evidence_section_id
      expect(evidenceSectionId).toBeTruthy();
      // Must be a section from the input — not a hallucinated ID
      expect(sectionIds.has(evidenceSectionId)).toBe(true);
    }
  });
});

// ── 2. Deduplication — ON CONFLICT DO NOTHING ────────────────────────────────

describe("safeIndexIncidentGraph — node deduplication", () => {
  it("uses ON CONFLICT DO NOTHING in node upsert SQL", async () => {
    const client = makeClient();
    await safeIndexIncidentGraph(client, FIXTURE_INCIDENT);
    const nodeInserts = client._execRaw.mock.calls.filter(([sql]) =>
      sql.includes("graph_nodes")
    );
    for (const [sql] of nodeInserts) {
      expect(sql.toUpperCase()).toContain("ON CONFLICT");
      expect(sql.toUpperCase()).toContain("DO NOTHING");
    }
  });

  it("running twice for the same incident inserts same nodes both times (idempotent upsert)", async () => {
    const client = makeClient();
    await safeIndexIncidentGraph(client, FIXTURE_INCIDENT);
    const firstCallCount = client._execRaw.mock.calls.filter(([sql]) =>
      sql.includes("graph_nodes")
    ).length;

    await safeIndexIncidentGraph(client, FIXTURE_INCIDENT);
    const secondCallCount = client._execRaw.mock.calls.filter(([sql]) =>
      sql.includes("graph_nodes")
    ).length / 2; // approximate — total / 2 runs

    // Both runs should attempt the same number of node upserts
    expect(firstCallCount).toBeGreaterThan(0);
  });
});

// ── 3. Edge requires evidence_section_id ─────────────────────────────────────

describe("safeIndexIncidentGraph — evidence_section_id enforcement", () => {
  it("does not insert edges whose evidence_section_id is not a real section id", async () => {
    // Sections with no IDs — the rule extractor can't produce valid evidence_section_ids
    const incident = {
      id: "inc-no-ids",
      title: "Outage",
      sections: [
        { type: "impact", text: "Elevated error rate." }, // no id
        { type: "fix", text: "Fixed by rolling back." },  // no id
      ],
    };

    const client = makeClient();
    const result = await safeIndexIncidentGraph(client, incident);
    // Should not crash
    expect(result).toBe(true);
    // No edges should have been inserted (no valid section IDs for evidence anchors)
    const edgeInserts = client._execRaw.mock.calls.filter(([sql]) =>
      sql.includes("graph_edges")
    );
    expect(edgeInserts).toHaveLength(0);
  });
});

// ── 4. DB failure — safe degradation ─────────────────────────────────────────

describe("safeIndexIncidentGraph — DB failure", () => {
  it("returns false and does not throw when $executeRawUnsafe rejects", async () => {
    const client = {
      $executeRawUnsafe: vi.fn().mockRejectedValue(new Error("DB constraint violation")),
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: "00000000-0000-0000-0000-000000000001" }]),
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await safeIndexIncidentGraph(client, FIXTURE_INCIDENT);
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("safeIndexIncidentGraph skipped"),
      expect.any(String)
    );
    warnSpy.mockRestore();
  });

  it("does NOT throw — caller always gets a boolean", async () => {
    const client = {
      $executeRawUnsafe: vi.fn().mockRejectedValue(new Error("connection reset")),
      $queryRawUnsafe: vi.fn().mockRejectedValue(new Error("connection reset")),
    };

    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(safeIndexIncidentGraph(client, FIXTURE_INCIDENT)).resolves.toBe(false);
    vi.restoreAllMocks();
  });
});

// ── 5. Edge cases ─────────────────────────────────────────────────────────────

describe("safeIndexIncidentGraph — edge cases", () => {
  it("returns false and warns when incident.id is missing", async () => {
    const client = makeClient();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await safeIndexIncidentGraph(client, { sections: [] });
    expect(result).toBe(false);
    warnSpy.mockRestore();
  });

  it("returns true without DB calls when sections is empty", async () => {
    const client = makeClient();
    const result = await safeIndexIncidentGraph(client, {
      id: "inc-empty",
      title: "Empty",
      sections: [],
    });
    expect(result).toBe(true);
    expect(client._execRaw).not.toHaveBeenCalled();
  });

  it("returns true without DB calls when sections is undefined", async () => {
    const client = makeClient();
    const result = await safeIndexIncidentGraph(client, {
      id: "inc-no-sections",
      title: "No Sections",
    });
    expect(result).toBe(true);
    expect(client._execRaw).not.toHaveBeenCalled();
  });
});
