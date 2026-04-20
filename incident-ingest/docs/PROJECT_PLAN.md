# Incident Atlas Pro — Project Plan

> **Stack:** Node.js + Express (ESM) · Vite + React 18 · PostgreSQL + Prisma · BullMQ + Redis · pgvector
> **Repo root:** `incident-ingest/` (pnpm workspace)

---

## Sprint Status Overview

| Sprint | Scope | Status |
|--------|-------|--------|
| Sprint 1 (Weeks 1–2) | Foundations: schema, ingest API, async worker, web skeleton | 🔶 In Progress |
| Sprint 2 (Weeks 3–4) | Search + similarity: embeddings, vector index, keyword filters | ⬜ Not started |
| Sprint 3 (Weeks 5–6) | Knowledge graph v1: entity extraction, graph explorer UI | ⬜ Not started |
| Sprint 4 (Weeks 7–8) | Quality + deploy: eval CI, Q&A, rate limits, demo | ⬜ Not started |

---

## Sprint 1 — Foundations

### What's Done
| Ticket | Description |
|--------|-------------|
| W1-001 | Prisma schema with `Incident` + `Section` models + UUID PKs |
| W1-002 | Initial migration applied; DB boots via docker-compose |
| W1-007 | React SPA skeleton with React Router v6 + TanStack Query v5 |
| W1-008 | Incident detail view rendering typed sections |

### What's Remaining

#### W1-003 — Real File Upload Ingestion
**Agent:** `backend_builder`
**Scope:** `apps/api/`
- Add `POST /ingest/upload` accepting multipart (PDF / Markdown / plain text)
- Store raw file to local disk (or minio volume)
- Insert a `documents` row with `parse_status = pending`
- Enqueue a BullMQ parse job; return `{ jobId }`
- Acceptance: curl upload succeeds, file persists, job appears in queue

#### W1-004 — Async Queue Worker (BullMQ + Redis)
**Agent:** `backend_builder`
**Scope:** `apps/worker/` (new), `docker-compose.yaml`
- Add Redis 7 service to docker-compose
- Create `apps/worker/` package with BullMQ `Worker` processing `parse` queue
- Move section-parsing logic from `index.js` into the worker job processor
- Graceful shutdown: drain in-flight jobs before exit
- Acceptance: `pnpm --filter @app/worker dev` boots, dummy job completes, worker survives SIGTERM

#### W1-004-QA — Review: Queue Worker
**Agent:** `qa_security`
- Verify worker reconnects on Redis failure
- Verify job errors are caught and don't crash the process
- Verify graceful shutdown doesn't silently drop in-flight jobs

#### W1-005 — NLP Pipeline Package
**Agent:** `backend_builder`
**Scope:** `packages/nlp/` (new)
- Extract section-parsing heuristic from `index.js` into a standalone ESM package
- Expose `parseSections(rawText) → Section[]` and `summarize(text, maxChars) → string`
- Unit-test with at least 3 fixture inputs covering: labeled sections, unlabeled paragraphs, empty input
- Acceptance: `packages/nlp` importable by both API and worker

#### W1-005-QA — Review: NLP Package
**Agent:** `qa_security`
- Handles malformed / empty text without throwing
- Summary never exceeds `maxChars`

#### W1-006 — Job Status Endpoint
**Agent:** `backend_builder`
**Scope:** `apps/api/`
- Add `GET /jobs/:jobId` → returns `{ id, status, progress?, result?, error? }`
- Status values: `waiting | active | completed | failed`
- Rate-limit polling to prevent thundering-herd (e.g., 1 req/s per IP)
- Acceptance: job created via upload returns trackable status via this endpoint

#### W1-006-QA — Review: Job Status
**Agent:** `qa_security`
- Endpoint responds < 50 ms (no DB round-trip for status)
- Returns 404 for unknown job IDs (not 500)

---

## Sprint 2 — Search + Similarity

### Schema Changes (architect must freeze first)
- Add `pgvector` extension to Postgres
- Add `summary_embedding vector(1536)` to `incidents` table
- Add `embedding vector(1536)` to `sections` table
- Add `documents(id, job_id, raw_path, hash, fetched_at, parse_status)` table (Worker reads from raw_path to avoid API memory issues)

### Tickets

#### W2-001 — pgvector Setup + Embedding Generation
**Agent:** `backend_builder`
**Scope:** `apps/api/prisma/`, `apps/worker/`
- Enable `pgvector` in migration
- After parse job completes, call embedding model (OpenAI `text-embedding-3-small`) for each section + incident summary
- Store vectors via Prisma raw query or `prisma-client-extensions`
- Acceptance: incident record has non-null `summary_embedding` after ingest

#### W2-001-QA
**Agent:** `qa_security`
- Embedding failures don't block incident creation (store null, retry async)
- Verify vector dimensions match model output

#### W2-002 — Keyword + Filter Search Endpoint
**Agent:** `backend_builder`
**Scope:** `apps/api/`
- `GET /search?q=&company=&from=&to=&tag=&severity=`
- Full-text search on title + summaryText using Postgres `to_tsvector`
- Combine with metadata filters
- Return paginated incident stubs

#### W2-002-QA
**Agent:** `qa_security`
- SQL injection hardening via parameterized queries
- Empty `q` returns all (with filters applied)

#### W2-003 — Similar Incidents Endpoint
**Agent:** `backend_builder`
**Scope:** `apps/api/`
- `GET /incidents/:id/similar` — cosine similarity on `summary_embedding`, top-5
- Include similarity score + brief reason in response

#### W2-004 — Search UI
**Agent:** `frontend_builder`
**Scope:** `apps/web/`
- Search bar on `/incidents` wired to `GET /search`
- Debounce 300 ms, show loading skeleton
- Incident card shows similarity score when coming from `/similar`

#### W2-004-QA
**Agent:** `qa_security`
- Network error renders inline error state (not blank page)
- Empty results render a null-state message

---

## Sprint 3 — Knowledge Graph v1

### Schema Changes (architect must freeze first)
- `graph_nodes(id, node_type, name, attrs_json)`
- `graph_edges(id, from_node_id, rel_type, to_node_id, incident_id, evidence_section_id)`
- `node_type` enum: `Service | Symptom | Trigger | RootCause | Fix | Runbook`
- `rel_type` enum: `AFFECTS | HAS_SYMPTOM | TRIGGERED_BY | CAUSED_BY | RESOLVED_BY`

### Tickets

#### W3-001 — Entity Extraction Worker Job
**Agent:** `backend_builder`
**Scope:** `apps/worker/`, `packages/nlp/`
- After embedding step, run LLM prompt to extract entities + relations from sections
- Insert `graph_nodes` + `graph_edges` with `evidence_section_id`

#### W3-001-QA
**Agent:** `qa_security`
- `evidence_section_id` is never null on graph edges
- Duplicate node names are de-duplicated (upsert by `node_type + name`)

#### W3-002 — Graph API Endpoints
**Agent:** `backend_builder`
**Scope:** `apps/api/`
- `GET /graph/patterns?service=&symptom=` — aggregate edge patterns across incidents
- `GET /graph/neighbors?node_id=&depth=1` — BFS up to depth N

#### W3-003 — Graph Explorer UI
**Agent:** `frontend_builder`
**Scope:** `apps/web/`
- New route `/graph` — force-directed graph (e.g., `react-force-graph`)
- Click node → sidebar shows linked incidents + evidence sections

#### W3-003-QA
**Agent:** `qa_security`
- Graph with 0 nodes renders empty state, not crash
- Deep-link `/graph?node=X` works on hard refresh

---

## Sprint 4 — Quality + Deploy

### Tickets

#### W4-001 — Eval Harness in CI
**Agent:** `backend_builder`
**Scope:** `apps/api/`, CI config
- `POST /eval/run` — runs golden queries against search + Q&A
- Gate merges on recall@5 ≥ 0.8

#### W4-002 — Citations-First Q&A
**Agent:** `backend_builder`
**Scope:** `apps/api/`
- `POST /qa` — LLM answers grounded in section text; refuses if no supporting evidence
- Every sentence in answer has a `section_id` citation

#### W4-002-QA
**Agent:** `qa_security`
- Prompt injection in question field is rejected
- Unanswerable questions return `{ refusal: true }`, not hallucination

#### W4-003 — Rate Limiting + Auth
**Agent:** `backend_builder`
- Per-IP rate limits on `/ingest`, `/search`, `/qa`
- Optional: API key header for ingest endpoints

#### W4-004 — Deploy + Demo
**Agent:** `release_integrator`
- Dockerfile for API + Worker
- docker-compose production profile (no dev volumes)
- Runbook updated with health check endpoints
- Demo script walkthrough validated end-to-end

---

## Agent Routing Quick Reference

| Work type | Agent | Model |
|-----------|-------|-------|
| Tech research / decision memos | `research_sot` | Gemini Flash |
| Schema + API contract freeze | `architect` | Gemini Pro High |
| Backend implementation | `backend_builder` | Claude Sonnet |
| Frontend implementation | `frontend_builder` | Claude Sonnet |
| Code review + security | `qa_security` | Claude Sonnet |
| Merge / release / runbook | `release_integrator` | Gemini Pro Low |

**Rule:** Every ticket that touches code gets a paired `-QA` review ticket. QA must sign off before merge.

---

## Execution Order for Sprint 1 Completion

```
research_sot   →  BullMQ vs alternatives decision memo
architect      →  Update API_SPEC (upload + job status) + DATA_MODEL (documents table)
backend_builder →  W1-004 (worker + Redis)
qa_security    →  W1-004-QA
backend_builder →  W1-005 (packages/nlp)
qa_security    →  W1-005-QA
backend_builder →  W1-003 (file upload) + W1-006 (job status)  [parallel]
qa_security    →  W1-003-QA + W1-006-QA
release_integrator → Sprint 1 smoke test + runbook update
```

---

## Environment Quick Reference

| Service | Port | Credentials |
|---------|------|-------------|
| PostgreSQL | 5432 | postgres / postgres / incident_ingest |
| Redis | 6379 | no auth (dev) |
| API | 3001 | — |
| Web | 5173 | — |

Env files to copy before first run:
- `apps/api/.env` ← `.env.example` (add `REDIS_URL=redis://localhost:6379`)
- `apps/web/.env` ← `.env.example`
