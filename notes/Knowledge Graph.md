---
aliases: [Knowledge Graph, Graph, Graph extraction, Entity graph]
tags: [project/incident-atlas-pro, graph]
---

# Knowledge Graph

*(Sprint 3)* Turns incident sections into an evidence-backed entity graph: which **service** had which **symptom**, caused by which **root_cause**, resolved by which **fix**. Powers graph viz, pattern discovery, and optional [[Citations-first QA|QA]] context. Code: `packages/nlp/src/graphExtract.js`; stored per [[Data model]] (`GraphNode`, `GraphEdge`).

## Schema of meaning
- **Node types**: `service | symptom | root_cause | fix` (unique on `(type, name)`).
- **Edge types**: `AFFECTS | HAS_SYMPTOM | CAUSED_BY | RESOLVED_BY`.
- **Iron rule**: every edge MUST carry an `evidence_section_id` pointing at a real section from the same batch. No evidence → edge dropped. (Same citations-first ethic as QA — no claim without a source, and it blocks LLM hallucination/injection.)

## Two extractors (`extractGraph`)
- **`rules` (default)** — deterministic regex patterns for symptoms / causes / fixes + a service name from title/company/tags. **High precision, low recall** — deliberately conservative: better to miss an entity than pollute the graph. A `NOISE_TERMS` blocklist rejects vague words ("error", "system", "outage"). Keeps ingest resilient with no LLM.
- **`ollama`** — [[Qwen3]] in strict-JSON mode extracts nodes/edges (min confidence 0.75), then the **same validators** run, then falls back to rules on any failure/empty result.

## Endpoints
- `GET /graph/patterns` — recurring node clusters (e.g. services that keep failing the same way).
- `GET /graph/neighbors?node_id=…&depth=…` — BFS up to 2 hops. Backs the [[Architecture|web]] graph explorer.

## Caveat for the pitch
Default is rules-based; **edge quality is unmeasured** and graph viz is a demo highlight built on heuristics. In QA, graph evidence can *enrich* an answer but **never justify one alone** (`fromGraphContext` flag in the [[Sufficiency gate]]). See [[Pitch caveats and gaps]].
