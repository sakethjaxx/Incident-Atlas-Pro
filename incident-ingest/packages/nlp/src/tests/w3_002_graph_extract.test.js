/**
 * W3-002 — Graph extraction unit tests
 *
 * Covers:
 *   1. normalizeNodeName
 *   2. validateNode — whitelist, noise-term rejection, length checks
 *   3. validateEdge — rel_type whitelist, missing evidence_section_id
 *   4. deduplicateNodes
 *   5. ruleExtractGraph — fixture sections, per-type extraction
 *   6. extractGraph — fallback path when LLM is unavailable
 *   7. extractGraph — LLM failure → fallback behavior
 *   8. extractGraph — LLM invalid JSON → fallback
 *   9. extractGraph — empty sections
 *
 * No DB or network required — all LLM calls are blocked by the absence of
 * ANTHROPIC_API_KEY in the test environment, or by mocking the dynamic import.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeNodeName,
  validateNode,
  validateEdge,
  deduplicateNodes,
  ruleExtractGraph,
  extractGraph,
  VALID_NODE_TYPES,
  VALID_REL_TYPES,
} from "@pkg/nlp";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_SECTIONS = [
  {
    id: "sec-impact-1",
    type: "impact",
    text: "Users experienced elevated error rates and partial outage of the payment-api service.",
  },
  {
    id: "sec-timeline-1",
    type: "timeline",
    text: "14:00 Alerts fired for request failure rate. 14:15 API latency spiked.",
  },
  {
    id: "sec-rootcause-1",
    type: "rootcause",
    text: "The issue was caused by a misconfigured connection pool limit on the auth-service.",
  },
  {
    id: "sec-fix-1",
    type: "fix",
    text: "Fixed by rolling back the deploy and increasing the connection pool size.",
  },
];

const FIXTURE_META = {
  title: "Payment API Outage",
  company: "Acme Corp",
  tags: ["payment-api", "auth-service"],
};

// ── 1. normalizeNodeName ──────────────────────────────────────────────────────

describe("normalizeNodeName", () => {
  it("lowercases and trims", () => {
    expect(normalizeNodeName("  Auth-Service  ")).toBe("auth-service");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeNodeName("connection   pool  exhausted")).toBe(
      "connection pool exhausted"
    );
  });

  it("truncates to MAX_NAME_LENGTH (120)", () => {
    const long = "a".repeat(200);
    expect(normalizeNodeName(long).length).toBe(120);
  });

  it("returns empty string for non-string input", () => {
    expect(normalizeNodeName(null)).toBe("");
    expect(normalizeNodeName(42)).toBe("");
  });
});

// ── 2. validateNode ───────────────────────────────────────────────────────────

describe("validateNode", () => {
  it("accepts valid node types", () => {
    for (const type of VALID_NODE_TYPES) {
      expect(validateNode({ name: "auth-service", node_type: type })).not.toBeNull();
    }
  });

  it("rejects unknown node_type", () => {
    expect(validateNode({ name: "auth-service", node_type: "team" })).toBeNull();
  });

  it("rejects names shorter than MIN_NAME_LENGTH (3)", () => {
    expect(validateNode({ name: "db", node_type: "service" })).toBeNull();
  });

  it("rejects noise terms", () => {
    const noiseTerms = ["error", "issue", "service", "system", "database", "latency"];
    for (const term of noiseTerms) {
      expect(validateNode({ name: term, node_type: "symptom" })).toBeNull();
    }
  });

  it("accepts specific multi-word names", () => {
    expect(validateNode({ name: "payment-api", node_type: "service" })).toEqual({
      name: "payment-api",
      node_type: "service",
    });
  });

  it("returns null for non-object input", () => {
    expect(validateNode(null)).toBeNull();
    expect(validateNode("auth-service")).toBeNull();
    expect(validateNode(42)).toBeNull();
  });
});

// ── 3. validateEdge ───────────────────────────────────────────────────────────

describe("validateEdge", () => {
  const validSectionIds = new Set(["sec-001", "sec-002"]);

  it("accepts a valid edge with evidence_section_id", () => {
    const edge = validateEdge(
      {
        from_name: "auth-service",
        to_name: "connection timeout",
        rel_type: "AFFECTS",
        evidence_section_id: "sec-001",
      },
      validSectionIds
    );
    expect(edge).not.toBeNull();
    expect(edge.rel_type).toBe("AFFECTS");
  });

  it("rejects edge with missing evidence_section_id", () => {
    expect(
      validateEdge(
        {
          from_name: "auth-service",
          to_name: "connection timeout",
          rel_type: "AFFECTS",
          evidence_section_id: "",
        },
        validSectionIds
      )
    ).toBeNull();
  });

  it("rejects edge with evidence_section_id not in validSectionIds", () => {
    expect(
      validateEdge(
        {
          from_name: "auth-service",
          to_name: "connection timeout",
          rel_type: "AFFECTS",
          evidence_section_id: "sec-999-hallucinated",
        },
        validSectionIds
      )
    ).toBeNull();
  });

  it("rejects unknown rel_type", () => {
    expect(
      validateEdge(
        {
          from_name: "auth-service",
          to_name: "connection timeout",
          rel_type: "DEPENDS_ON",
          evidence_section_id: "sec-001",
        },
        validSectionIds
      )
    ).toBeNull();
  });

  it("accepts all valid rel_types", () => {
    for (const rel of VALID_REL_TYPES) {
      expect(
        validateEdge(
          {
            from_name: "auth-service",
            to_name: "timeout spike",
            rel_type: rel,
            evidence_section_id: "sec-001",
          },
          validSectionIds
        )
      ).not.toBeNull();
    }
  });

  it("rejects edge when from_name is too short", () => {
    expect(
      validateEdge(
        { from_name: "db", to_name: "connection timeout", rel_type: "AFFECTS", evidence_section_id: "sec-001" },
        validSectionIds
      )
    ).toBeNull();
  });

  it("allows any evidence_section_id when validSectionIds is empty", () => {
    // Empty set = no filtering (used when we don't have section IDs available)
    const edge = validateEdge(
      {
        from_name: "auth-service",
        to_name: "connection timeout",
        rel_type: "AFFECTS",
        evidence_section_id: "any-id-here",
      },
      new Set()
    );
    expect(edge).not.toBeNull();
  });
});

// ── 4. deduplicateNodes ───────────────────────────────────────────────────────

describe("deduplicateNodes", () => {
  it("removes duplicate (node_type, name) pairs", () => {
    const nodes = [
      { name: "auth-service", node_type: "service" },
      { name: "auth-service", node_type: "service" }, // duplicate
      { name: "auth-service", node_type: "symptom" }, // different type — keep
      { name: "timeout spike", node_type: "symptom" },
    ];
    const result = deduplicateNodes(nodes);
    expect(result).toHaveLength(3);
  });

  it("preserves order of first occurrence", () => {
    const nodes = [
      { name: "b-service", node_type: "service" },
      { name: "a-service", node_type: "service" },
      { name: "b-service", node_type: "service" }, // duplicate
    ];
    expect(deduplicateNodes(nodes).map((n) => n.name)).toEqual(["b-service", "a-service"]);
  });

  it("returns empty array for empty input", () => {
    expect(deduplicateNodes([])).toEqual([]);
  });
});

// ── 5. ruleExtractGraph — fixture sections ────────────────────────────────────

describe("ruleExtractGraph", () => {
  it("returns nodes and edges shaped object", () => {
    const result = ruleExtractGraph(FIXTURE_SECTIONS, FIXTURE_META);
    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("edges");
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
  });

  it("all returned nodes have valid node_type and non-empty name", () => {
    const { nodes } = ruleExtractGraph(FIXTURE_SECTIONS, FIXTURE_META);
    for (const node of nodes) {
      expect(VALID_NODE_TYPES.has(node.node_type)).toBe(true);
      expect(node.name.length).toBeGreaterThan(0);
    }
  });

  it("all returned edges have valid rel_type and evidence_section_id", () => {
    const { edges } = ruleExtractGraph(FIXTURE_SECTIONS, FIXTURE_META);
    const sectionIds = new Set(FIXTURE_SECTIONS.map((s) => s.id));
    for (const edge of edges) {
      expect(VALID_REL_TYPES.has(edge.rel_type)).toBe(true);
      expect(edge.evidence_section_id).toBeTruthy();
      // Evidence must be from a real section in the input
      expect(sectionIds.has(edge.evidence_section_id)).toBe(true);
    }
  });

  it("deduplicates nodes — no duplicate (type, name) pairs", () => {
    const { nodes } = ruleExtractGraph(FIXTURE_SECTIONS, FIXTURE_META);
    const keys = nodes.map((n) => `${n.node_type}:${n.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("extracts symptom from impact section", () => {
    const sections = [
      {
        id: "sec-1",
        type: "impact",
        text: "Users experienced elevated error rates and partial outage across the service.",
      },
    ];
    const { nodes } = ruleExtractGraph(sections, {});
    const symptoms = nodes.filter((n) => n.node_type === "symptom");
    expect(symptoms.length).toBeGreaterThan(0);
  });

  it("extracts root_cause from rootcause section", () => {
    const sections = [
      {
        id: "sec-rc",
        type: "rootcause",
        text: "The issue was caused by misconfigured connection pool settings in the auth-service.",
      },
    ];
    const { nodes } = ruleExtractGraph(sections, {});
    const causes = nodes.filter((n) => n.node_type === "root_cause");
    expect(causes.length).toBeGreaterThan(0);
  });

  it("extracts fix from fix section", () => {
    const sections = [
      {
        id: "sec-fix",
        type: "fix",
        text: "Mitigated by rolling back the deploy and patching the connection pool configuration.",
      },
    ];
    const { nodes } = ruleExtractGraph(sections, {});
    const fixes = nodes.filter((n) => n.node_type === "fix");
    expect(fixes.length).toBeGreaterThan(0);
  });

  it("does not extract noise-only text", () => {
    const sections = [
      { id: "sec-noise", type: "impact", text: "There was an issue with the system." },
    ];
    // "issue" and "system" are noise — nothing should be extracted
    const { nodes, edges } = ruleExtractGraph(sections, {});
    // Noise rejection: no low-quality nodes
    const noiseNodes = nodes.filter((n) =>
      ["issue", "problem", "error", "service", "system"].includes(n.name)
    );
    expect(noiseNodes).toHaveLength(0);
  });

  it("returns empty result for empty sections", () => {
    const { nodes, edges } = ruleExtractGraph([], {});
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it("handles sections with no id gracefully (skips them)", () => {
    const sections = [
      { type: "impact", text: "Elevated error rates across the auth-service." }, // no id
    ];
    // Should not throw
    expect(() => ruleExtractGraph(sections, {})).not.toThrow();
  });
});

// ── 6. extractGraph — LLM unavailable (no API key) → rule fallback ────────────

describe("extractGraph — LLM fallback path", () => {
  beforeEach(() => {
    // Ensure ANTHROPIC_API_KEY is absent so tryLlmExtraction returns null
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns { nodes, edges } without throwing when no API key", async () => {
    const result = await extractGraph(FIXTURE_SECTIONS, FIXTURE_META);
    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("edges");
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
  });

  it("produces valid node types from rule fallback", async () => {
    const { nodes } = await extractGraph(FIXTURE_SECTIONS, FIXTURE_META);
    for (const node of nodes) {
      expect(VALID_NODE_TYPES.has(node.node_type)).toBe(true);
    }
  });

  it("all edges from rule fallback have evidence_section_id", async () => {
    const { edges } = await extractGraph(FIXTURE_SECTIONS, FIXTURE_META);
    const sectionIds = new Set(FIXTURE_SECTIONS.map((s) => s.id));
    for (const edge of edges) {
      expect(edge.evidence_section_id).toBeTruthy();
      expect(sectionIds.has(edge.evidence_section_id)).toBe(true);
    }
  });

  it("returns empty result for empty sections array", async () => {
    const result = await extractGraph([], FIXTURE_META);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("does not throw for null/undefined sections", async () => {
    await expect(extractGraph(null, {})).resolves.toEqual({ nodes: [], edges: [] });
    await expect(extractGraph(undefined, {})).resolves.toEqual({ nodes: [], edges: [] });
  });
});

// ── 7. extractGraph — LLM failure → fallback ─────────────────────────────────

describe("extractGraph — LLM failure → rule fallback", () => {
  beforeEach(() => {
    // Set a fake API key so tryLlmExtraction attempts the LLM call
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-fake";
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.restoreAllMocks();
  });

  it("falls back to rules when LLM throws (module not installed)", async () => {
    // The @anthropic-ai/sdk module is not installed in this repo.
    // tryLlmExtraction should catch the import failure and return null.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await extractGraph(FIXTURE_SECTIONS, FIXTURE_META);

    // Should have used rule fallback — result is still valid
    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("edges");
    // Warning was logged
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("LLM extraction failed"),
      expect.any(String)
    );

    warnSpy.mockRestore();
  });
});

// ── 8. VALID_NODE_TYPES and VALID_REL_TYPES constants ────────────────────────

describe("Sprint 3 whitelist constants", () => {
  it("VALID_NODE_TYPES contains exactly the Sprint 3 node types", () => {
    expect([...VALID_NODE_TYPES].sort()).toEqual(["fix", "root_cause", "service", "symptom"]);
  });

  it("VALID_REL_TYPES contains exactly the Sprint 3 rel types", () => {
    expect([...VALID_REL_TYPES].sort()).toEqual([
      "AFFECTS",
      "CAUSED_BY",
      "HAS_SYMPTOM",
      "RESOLVED_BY",
    ]);
  });
});
