---
aliases: [Data model, Schema, Prisma schema]
tags: [project/incident-atlas-pro, database]
---

# Data model

Part of [[Architecture]] · defined in `apps/api/prisma/schema.prisma` (Postgres + [[pgvector]]).

## Ingestion chain (raw → structured)
`Source` → `Document` → `IngestJob` → **`Incident`** → `Section[]` → `Chunk[]`

- **Source** — a crawl/upload origin (blog / statuspage / github / pdf / manual).
- **Document** — raw fetched/uploaded text, dedup by `hash`, `parseStatus` state machine.
- **IngestJob** — per-document progress (queued → running → success/failed), driven by the [[Architecture|worker]].

## Core records
- **Incident** — the normalized record: title, date, company, products[], severity, tags[], `summaryText`, `summaryEmbedding` (`vector(1536)`). 1:N → Section, Chunk, GraphEdge.
- **Section** — typed slice: `SectionType = impact | timeline | rootcause | fix`, `text`, own `embedding`. **The citation unit** — every answer cites a section.
- **Chunk** *(Sprint 5)* — retrieval unit. Either a whole `section` chunk or `paragraph` slices of long sections. Keeps exact anchors (`incidentId` + `sectionId`) + **denormalized** company/severity/tags so [[Hybrid retrieval]] can filter *before* scoring. Holds `embedding` + optional [[TurboQuant]] `tqCodes/tqResidual/tqMeta`.

> [!note] The 1536-d contract
> All vector columns are fixed `vector(1536)`. Model-native dims (bge-small=384, bge-m3=1024) are L2-normalized then **zero-padded** to 1536 — cosine distance is unchanged. See [[embeddings]].

## Knowledge graph (Sprint 3) — see [[Knowledge Graph]]
- **GraphNode** — `nodeType = service | symptom | root_cause | fix`, unique on `(node_type, name)`.
- **GraphEdge** — directed `relType = AFFECTS | HAS_SYMPTOM | CAUSED_BY | RESOLVED_BY`, anchored to an incident **and a mandatory `evidenceSectionId`** (no evidence → edge dropped). Cascade on incident delete; RESTRICT on node/section delete.

## Quality & governance (Sprint 4)
- **QaQuery** — eval query set (expected incident/section/graph ids, `critical` flag, `querySetVersion`).
- **EvalRun** — one [[Eval harness]] run: metrics, thresholds, config, git sha, model.
- **AuditLog** — every QA call: action, hashes, retrieved ids, refusal code, latency, model. Backs the trust/compliance story.

See also: [[Incident Atlas Pro]]
