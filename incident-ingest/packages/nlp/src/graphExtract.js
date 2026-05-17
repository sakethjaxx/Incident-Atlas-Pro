/**
 * @pkg/nlp — Sprint 3 graph extraction
 *
 * Public API:
 *   extractGraph(sections, incidentMeta?)  → { nodes, edges }
 *   ruleExtractGraph(sections, incidentMeta?)  → { nodes, edges }  (deterministic fallback, exported for testing)
 *   normalizeNodeName(name)  → string
 *   VALID_NODE_TYPES  → Set<string>
 *   VALID_REL_TYPES   → Set<string>
 *
 * Design
 * ──────
 * • extractGraph() is the primary extraction entry point.
 *   It tries an LLM call (if ANTHROPIC_API_KEY is set), validates the output,
 *   and falls back to the deterministic rule extractor on any error or
 *   low-confidence/invalid result.
 *
 * • ruleExtractGraph() is the deterministic fallback. High-precision, low-recall:
 *   its job is to keep ingest resilient when the LLM is unavailable. It is
 *   intentionally conservative — better to miss an entity than to pollute the graph.
 *
 * • Node deduplication key: (node_type, normalizeNodeName(name)).
 *   Normalization: lowercase, trim, collapse repeated spaces.
 *
 * • Evidence rule: every edge MUST carry an evidence_section_id.
 *   Edges without one are silently dropped at the validation layer.
 *
 * • Node type whitelist: service | symptom | root_cause | fix
 * • Rel type whitelist:  AFFECTS | HAS_SYMPTOM | CAUSED_BY | RESOLVED_BY
 *
 * Input contract (from ARCHITECTURE.md):
 *   sections: [{ id: string, type: string, text: string }]
 *   incidentMeta?: { title?: string, company?: string, tags?: string[] }
 *
 * Output contract:
 *   {
 *     nodes: [{ name: string, node_type: string }],
 *     edges: [{
 *       from_name: string,
 *       to_name:   string,
 *       rel_type:  string,
 *       evidence_section_id: string
 *     }]
 *   }
 *
 * Zero runtime dependencies beyond Node.js built-ins (and optional Anthropic SDK).
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const VALID_NODE_TYPES = Object.freeze(
  new Set(["service", "symptom", "root_cause", "fix"])
);

export const VALID_REL_TYPES = Object.freeze(
  new Set(["AFFECTS", "HAS_SYMPTOM", "CAUSED_BY", "RESOLVED_BY"])
);

/** Minimum token length for a node name — filters generic single words */
const MIN_NAME_LENGTH = 3;

/** Max name length (truncation guard) */
const MAX_NAME_LENGTH = 120;

/**
 * Generic terms that are too vague to be useful as graph nodes.
 * These are rejected even if the rule extractor finds them.
 */
const NOISE_TERMS = new Set([
  "issue", "problem", "error", "bug", "failure", "incident", "outage",
  "service", "system", "database", "latency", "timeout", "api", "server",
  "alert", "alarm", "event", "condition", "situation", "thing", "stuff",
]);

// ─── Name normalization ───────────────────────────────────────────────────────

/**
 * Normalize a node name for deduplication keying.
 * Lowercases, trims, collapses internal whitespace.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeNodeName(name) {
  if (typeof name !== "string") return "";
  return name.toLowerCase().trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Validate and sanitize a raw node object from extraction output.
 * Returns null if the node should be dropped.
 *
 * @param {{ name: string, node_type: string } | unknown} raw
 * @returns {{ name: string, node_type: string } | null}
 */
export function validateNode(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = normalizeNodeName(raw.name ?? "");
  const node_type = typeof raw.node_type === "string" ? raw.node_type.trim().toLowerCase() : "";

  if (!VALID_NODE_TYPES.has(node_type)) return null;
  if (name.length < MIN_NAME_LENGTH) return null;
  if (NOISE_TERMS.has(name)) return null;

  return { name, node_type };
}

/**
 * Validate and sanitize a raw edge object from extraction output.
 * Returns null if the edge should be dropped.
 *
 * @param {unknown} raw
 * @param {Set<string>} validSectionIds   — set of valid section IDs for this batch
 * @returns {{ from_name, to_name, rel_type, evidence_section_id } | null}
 */
export function validateEdge(raw, validSectionIds) {
  if (!raw || typeof raw !== "object") return null;

  const from_name = normalizeNodeName(raw.from_name ?? "");
  const to_name = normalizeNodeName(raw.to_name ?? "");
  const rel_type = typeof raw.rel_type === "string" ? raw.rel_type.trim().toUpperCase() : "";
  const evidence_section_id = typeof raw.evidence_section_id === "string"
    ? raw.evidence_section_id.trim()
    : "";

  if (!from_name || from_name.length < MIN_NAME_LENGTH) return null;
  if (!to_name || to_name.length < MIN_NAME_LENGTH) return null;
  if (!VALID_REL_TYPES.has(rel_type)) return null;
  // evidence_section_id is MANDATORY
  if (!evidence_section_id) return null;
  // Must be a real section ID from this batch (prevents injection/hallucination)
  if (validSectionIds.size > 0 && !validSectionIds.has(evidence_section_id)) return null;

  return { from_name, to_name, rel_type, evidence_section_id };
}

/**
 * Deduplicate nodes: same (node_type, name) → keep first occurrence only.
 *
 * @param {Array<{name: string, node_type: string}>} nodes
 * @returns {Array<{name: string, node_type: string}>}
 */
export function deduplicateNodes(nodes) {
  const seen = new Set();
  return nodes.filter((n) => {
    const key = `${n.node_type}:${n.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Rule-based extractor (deterministic fallback) ────────────────────────────

// Pattern groups for the rule extractor
const SYMPTOM_PATTERNS = [
  /elevated\s+(?:error|failure|latency|cpu|memory|disk)\s+rate/i,
  /(?:request|api|query)\s+(?:failure|timeout|error)s?\b/i,
  /(?:partial|full|complete)\s+outage/i,
  /\b(?:oom\s+kill|out\s+of\s+memory)\b/i,
  /\b(?:high\s+(?:latency|cpu|memory|error))\b/i,
  /\b(?:5[0-9][0-9]\s+errors?|http\s+5\d\d)\b/i,
  /\bconnection\s+(?:pool\s+)?(?:exhausted|saturated|refused)\b/i,
  /\bcascading\s+(?:failure|error|timeout)/i,
  /\b(?:degraded|slow|unresponsive)\s+(?:service|api|endpoint|response)/i,
];

const CAUSED_BY_PATTERNS = [
  /(?:caused?\s+by|due\s+to|triggered?\s+by|because\s+of|resulted?\s+from)\s+([^.;,\n]{4,80})/i,
  /(?:root\s+cause(?:\s+was)?|underlying\s+cause(?:\s+was)?)[:\s]+([^.;\n]{4,80})/i,
  /(?:the\s+issue\s+was|problem\s+was)\s+([^.;\n]{4,80})/i,
];

const FIX_PATTERNS = [
  /(?:fixed?\s+by|mitigated?\s+by|resolved?\s+by|rolled?\s+back|reverted?)\s+([^.;,\n]{4,80})/i,
  /(?:restarted?|scaled?\s+(?:up|down|out)|disabled?|patched?|upgraded?)\s+([^.;,\n]{4,80})/i,
  /(?:increased?\s+(?:capacity|pool|limit|timeout)|decreased?\s+(?:batch|limit))\s*([^.;\n]{0,60})/i,
  /(?:deployed?\s+(?:fix|patch|hotfix|update)|pushed?\s+(?:fix|hotfix))\s+([^.;,\n]{0,60})/i,
];

/**
 * Extract a service candidate from the incident title/company/tags.
 *
 * @param {{ title?: string, company?: string, tags?: string[] }} meta
 * @returns {string | null}
 */
function extractServiceFromMeta(meta) {
  if (!meta) return null;
  // Use title-derived service name (first capitalized token or compound noun)
  const sources = [meta.title, meta.company, ...(meta.tags ?? [])].filter(Boolean);
  for (const src of sources) {
    // Look for product-like compound tokens (e.g., "auth-service", "PaymentAPI")
    const match = src.match(/\b([A-Za-z][A-Za-z0-9][-a-zA-Z0-9]{2,30})\b/);
    if (match) {
      const candidate = normalizeNodeName(match[1]);
      if (!NOISE_TERMS.has(candidate) && candidate.length >= MIN_NAME_LENGTH) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Deterministic rule-based graph extractor.
 *
 * High precision, low recall — designed as a non-blocking fallback.
 * Only extracts what the rules are confident about.
 *
 * @param {Array<{id: string, type: string, text: string}>} sections
 * @param {{ title?: string, company?: string, tags?: string[] }} [incidentMeta]
 * @returns {{ nodes: Array<{name: string, node_type: string}>, edges: Array<{from_name, to_name, rel_type, evidence_section_id}> }}
 */
export function ruleExtractGraph(sections, incidentMeta = {}) {
  const nodes = [];
  const edges = [];
  const sectionIds = new Set(sections.map((s) => s.id).filter(Boolean));

  // Service node from metadata
  const serviceNode = extractServiceFromMeta(incidentMeta);
  if (serviceNode) {
    nodes.push({ name: serviceNode, node_type: "service" });
  }

  for (const section of sections) {
    if (!section.id || !section.type || !section.text) continue;
    const text = section.text;
    const type = section.type;

    // ── Symptom extraction (impact / timeline sections) ──────────────────
    if (type === "impact" || type === "timeline") {
      for (const pattern of SYMPTOM_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
          const symptomName = normalizeNodeName(match[0].slice(0, 80));
          if (!NOISE_TERMS.has(symptomName) && symptomName.length >= MIN_NAME_LENGTH) {
            nodes.push({ name: symptomName, node_type: "symptom" });
            // If we have a service, wire: service AFFECTS symptom
            if (serviceNode) {
              edges.push({
                from_name: serviceNode,
                to_name: symptomName,
                rel_type: "AFFECTS",
                evidence_section_id: section.id,
              });
            }
            break; // one symptom per section to avoid over-extraction
          }
        }
      }
    }

    // ── Root cause extraction (rootcause sections) ───────────────────────
    if (type === "rootcause") {
      for (const pattern of CAUSED_BY_PATTERNS) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const causeName = normalizeNodeName(match[1].trim().slice(0, 80));
          if (!NOISE_TERMS.has(causeName) && causeName.length >= MIN_NAME_LENGTH) {
            nodes.push({ name: causeName, node_type: "root_cause" });
            // Wire: service (or first symptom node) CAUSED_BY root_cause
            const fromName = serviceNode ?? nodes.find((n) => n.node_type === "symptom")?.name;
            if (fromName) {
              edges.push({
                from_name: fromName,
                to_name: causeName,
                rel_type: "CAUSED_BY",
                evidence_section_id: section.id,
              });
            }
            break;
          }
        }
      }
    }

    // ── Fix extraction (fix sections) ────────────────────────────────────
    if (type === "fix") {
      for (const pattern of FIX_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
          const rawFix = (match[1] ?? match[0]).trim().slice(0, 80);
          const fixName = normalizeNodeName(rawFix);
          if (!NOISE_TERMS.has(fixName) && fixName.length >= MIN_NAME_LENGTH) {
            nodes.push({ name: fixName, node_type: "fix" });
            // Wire: root_cause (or service) RESOLVED_BY fix
            const fromName = nodes.find((n) => n.node_type === "root_cause")?.name ?? serviceNode;
            if (fromName) {
              edges.push({
                from_name: fromName,
                to_name: fixName,
                rel_type: "RESOLVED_BY",
                evidence_section_id: section.id,
              });
            }
            break;
          }
        }
      }
    }
  }

  return {
    nodes: deduplicateNodes(nodes.filter((n) => validateNode(n))),
    edges: edges.filter((e) => validateEdge(e, sectionIds)),
  };
}

// ─── LLM extraction helper ────────────────────────────────────────────────────

/**
 * Build the extraction prompt for the Claude Haiku model.
 *
 * @param {Array<{id: string, type: string, text: string}>} sections
 * @param {{ title?: string, company?: string }} incidentMeta
 * @returns {string}
 */
function buildExtractionPrompt(sections, incidentMeta) {
  const sectionText = sections
    .map((s) => `[section_id: ${s.id}, type: ${s.type}]\n${s.text}`)
    .join("\n\n---\n\n");

  return `You are an expert SRE analyst. Extract a structured knowledge graph from the following incident sections.

Incident: ${incidentMeta.title ?? "Unknown"} (${incidentMeta.company ?? "Unknown"})

SECTIONS:
${sectionText}

Rules:
- Extract ONLY concrete, specific entities (not generic terms like "error", "issue", "system").
- Node types MUST be exactly one of: service, symptom, root_cause, fix
- Rel types MUST be exactly one of: AFFECTS, HAS_SYMPTOM, CAUSED_BY, RESOLVED_BY
- Every edge MUST include the section_id where the evidence was found.
- Normalize node names: lowercase, trim whitespace.
- Minimum confidence: 0.75. Drop any candidate below this threshold.

Respond with ONLY a valid JSON object, no prose:
{
  "nodes": [{"name": "<string>", "node_type": "<service|symptom|root_cause|fix>"}],
  "edges": [{"from_name": "<string>", "to_name": "<string>", "rel_type": "<AFFECTS|HAS_SYMPTOM|CAUSED_BY|RESOLVED_BY>", "evidence_section_id": "<section_id from above>"}]
}`;
}

/**
 * Attempt LLM extraction via Claude Haiku 4.5 (or compatible).
 * Returns null if the LLM is unavailable, times out, or returns invalid JSON.
 *
 * Requires ANTHROPIC_API_KEY env var.
 * Does NOT throw — caller always gets null on failure.
 *
 * @param {Array<{id: string, type: string, text: string}>} sections
 * @param {{ title?: string, company?: string }} incidentMeta
 * @returns {Promise<{nodes: unknown[], edges: unknown[]} | null>}
 */
async function tryLlmExtraction(sections, incidentMeta) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    // Lazy-import so the module is usable without the SDK installed
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: buildExtractionPrompt(sections, incidentMeta),
        },
      ],
    });

    const rawText = response?.content?.[0]?.text ?? "";
    // Strip markdown code fences if present
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonText);

    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return null;
    }

    return parsed;
  } catch (err) {
    // Log a condensed warning — do NOT propagate LLM errors to caller
    console.warn(
      "[graphExtract] LLM extraction failed, falling back to rules:",
      err?.message?.slice(0, 120) ?? String(err).slice(0, 120)
    );
    return null;
  }
}

// ─── Primary entry point ──────────────────────────────────────────────────────

/**
 * Extract a knowledge graph from incident sections.
 *
 * Tries the LLM path first (if ANTHROPIC_API_KEY is set).
 * Falls back to the deterministic rule extractor on any failure.
 * NEVER throws — always returns { nodes, edges }.
 *
 * @param {Array<{id: string, type: string, text: string}>} sections
 * @param {{ title?: string, company?: string, tags?: string[] }} [incidentMeta]
 * @returns {Promise<{ nodes: Array<{name: string, node_type: string}>, edges: Array<{from_name, to_name, rel_type, evidence_section_id}> }>}
 */
export async function extractGraph(sections, incidentMeta = {}) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return { nodes: [], edges: [] };
  }

  const validSectionIds = new Set(sections.map((s) => s.id).filter(Boolean));

  // ── Try LLM path ──────────────────────────────────────────────────────────
  const llmRaw = await tryLlmExtraction(sections, incidentMeta);

  if (llmRaw) {
    const nodes = llmRaw.nodes
      .map((n) => validateNode(n))
      .filter(Boolean);
    const edges = llmRaw.edges
      .map((e) => validateEdge(e, validSectionIds))
      .filter(Boolean);

    if (nodes.length > 0 || edges.length > 0) {
      return {
        nodes: deduplicateNodes(nodes),
        edges,
      };
    }
    // LLM returned something but validation stripped everything — fall through
    console.warn("[graphExtract] LLM output was empty after validation, using rule fallback");
  }

  // ── Rule fallback ─────────────────────────────────────────────────────────
  return ruleExtractGraph(sections, incidentMeta);
}
