# Incident Atlas Pro — Project Spec (v0.2)

**Date:** 2026-03-07  
**Goal:** Build a deployable 8-week MVP for **Incident Atlas Pro** — an incident-intelligence system with **Incident Knowledge Graph (IKG)** + **Hybrid Retrieval (keyword + vector + reranking)** using **open-source/public incident data**.

## What it solves
During outages, engineers waste time searching scattered knowledge (postmortems, status pages, runbooks, GitHub incident reports). Incident Atlas Pro builds a searchable incident memory that can quickly answer:
- Have we seen this pattern?
- What typically caused it?
- What mitigations worked?

## MVP pillars
1. **Ingestion + normalization** (crawl/scrape or upload; extract fields; store raw + structured)
2. **Incident sectioning** (impact / timeline / root cause / mitigation)
3. **Hybrid search** (FTS + vector over summaries/sections + filters)
4. **Similarity + reasons** ("similar incidents" with explanation)
5. **Knowledge graph explorer** (causes ↔ symptoms ↔ services; top recurring patterns)
6. **Evidence-first Q&A (optional generation)** with citations + refusal when evidence insufficient
7. **Postmortem outline generator** (template/questions; no invented facts)

## Agentic execution note (no Perplexity credits)
This project uses a 7-role agentic workflow. If Perplexity API is unavailable, the **Research / Source-of-truth** role runs on **Gemini + web browsing + official docs** and must still produce links and a decision memo.

## Non-goals (MVP scope control)
- No enterprise connectors requiring paid keys
- No fully automated “perfect” scraping; best-effort extraction + fallback manual upload
- No heavy custom model training; use off-the-shelf embeddings / rerankers
- Generation is optional; retrieval and evidence UX are primary

## Definition of Done (MVP)
- Upload/crawl ≥ 30–50 incident docs into DB
- Search returns relevant incidents with evidence sections and filters
- Similar incidents panel shows “reasons”
- Graph explorer displays top patterns and neighbor browsing with evidence pointers
- Eval harness runs in CI and tracks MRR/Recall@K over a seed query set
- (Optional) Q&A returns citations or refuses if unsupported
- Deployable demo with 5-min script


# Requirements (MVP)

## Functional requirements
### Ingestion + normalization
- Crawl/scrape or upload raw docs (HTML/PDF/Markdown)
- Extract and store: title, date, duration, impact, timeline, root cause, mitigations
- Store **raw document** + **extracted text** + **structured metadata**
- Async job pipeline (queue worker) with retries/backoff and per-step status

### Incident sections
- Split incidents into typed sections:
  - impact
  - timeline
  - root cause
  - fix/mitigation
- Persist sections separately for retrieval + UI highlighting

### Hybrid search
- Full-text search + vector search over incident summaries and sections
- Filters: date / company / category / tags
- Return ranked incidents + matching sections + scores

### Similarity + reasons
- Endpoint + UI panel for “similar incidents”
- Provide “reasons” such as:
  - matched symptoms
  - same trigger
  - similar fix

### Knowledge graph explorer
- Nodes: Service, Symptom, Trigger, RootCause, Fix, Runbook
- Edges: AFFECTS, HAS_SYMPTOM, TRIGGERED_BY, CAUSED_BY, RESOLVED_BY
- Graph browsing and top recurring pattern queries
- Every edge stores an evidence pointer to a section

### Evidence-backed Q&A (optional)
- Retrieval-first: answer from returned evidence only
- Must cite exact incident excerpts / section references
- Must refuse when evidence is insufficient

### Postmortem outline generator
- Given a new incident description, produce a postmortem outline + questions
- Must not invent incident facts; uses templates and prompts only

## Non-functional requirements
- Evidence-first UX: citations or refusal (no unsupported claims)
- Repeatability: evaluation harness with regression in CI
- Robust ingestion: store raw + best-effort extraction + manual correction path
- Security (MVP):
  - basic auth for admin ingestion endpoints
  - rate limits on scraping and Q&A
  - audit logs for prompt/versioned outputs

## Quality gates
- Every PR includes tests for new logic
- Backend boots locally; DB connectivity verified
- Migrations apply cleanly from scratch
- CI runs unit + integration tests + eval regression


# Architecture

## High-level
- **Frontend:** Next.js + Tailwind
- **Backend:** FastAPI (or Node/Express)
- **Workers:** Redis queue (RQ/Celery/BullMQ)
- **Data:**
  - Postgres for metadata
  - Vector DB: pgvector or Qdrant for embeddings
  - Graph stored in Postgres edge tables (Neo4j optional)
- **Storage:** S3/minio/local for raw docs + parsed artifacts
- **Observability:** structured logs + metrics; basic tracing

## Data flow (happy path)
Upload/Crawl → parse → extract fields → section → embed → index → graph extract → ready for search/graph


# Data Model

## Tables (minimum)
- `sources(id, name, url, type, crawl_policy)`
- `documents(id, source_id, raw_path, hash, fetched_at, parse_status)`
- `incidents(id, title, date, company, products, duration, severity, tags, summary_text, summary_embedding)`
- `sections(id, incident_id, type[impact|timeline|rootcause|fix], text, embedding)`
- `graph_nodes(id, node_type[Service|Symptom|Trigger|RootCause|Fix|Runbook], name, attrs_json)`
- `graph_edges(id, from_node_id, rel_type[AFFECTS|HAS_SYMPTOM|TRIGGERED_BY|CAUSED_BY|RESOLVED_BY], to_node_id, incident_id, evidence_section_id)`
- `qa_queries(id, question, expected_incident_ids, created_at)`
- `audit_logs(id, action, prompt_version, input_hash, output_hash, created_at)`

## Notes
- Store embeddings in pgvector columns or an external vector DB.
- `evidence_section_id` is mandatory for graph edges and Q&A citations.


# API Spec (Minimum)

## Ingestion
- `POST /sources`
- `POST /documents/upload`
- `POST /ingest/{document_id}` (async job)
- `GET /documents/{id}` (status + artifacts)

## Search
- `GET /search?q=...&from=...&to=...&company=...&tag=...`
- `GET /incidents/{id}`
- `GET /incidents/{id}/similar`

## Graph
- `GET /graph/patterns?service=...&symptom=...`
- `GET /graph/neighbors?node_id=...&depth=1`

## Evaluation
- `POST /eval/queries`
- `POST /eval/run`
- `GET /eval/latest`

## Q&A (optional)
- `POST /qa` (citations-first; refuse if unsupported)


# Ingestion Pipeline

## Stages
1. Fetch (crawl or upload)
2. Parse (HTML/PDF/MD to text; store raw + extracted)
3. Extract fields (title/date/company/impact/timeline/root cause/fix)
4. Sectioning (impact/timeline/rootcause/fix sections)
5. Chunking + Embeddings (summary + key sections)
6. Indexing (FTS + vector)
7. Graph extraction (entities + edges with evidence pointers)
8. Persist job status + artifacts

## Reliability patterns
- Retry/backoff per stage
- Store partial artifacts even on failure
- Modular source adapters
- Manual correction workflow for key fields


# Retrieval Pipeline

## Candidate recall
- Keyword search (Postgres FTS/BM25)
- Vector search (summary + key sections)

## Rerank
- Cross-encoder reranks top N candidates to top K

## Assemble
Return:
- ranked incidents
- top matching sections (evidence)
- optional graph patterns

## Optional generation (strict)
- Generate only from retrieved evidence
- Every claim must cite a section
- Refuse if evidence is insufficient


# Evaluation Plan

## Dataset
- Start with 30–50 queries paired with expected incident IDs.
- Grow as you ingest more sources.

## Metrics
- Recall@K (@5, @10)
- MRR
- NDCG@K (optional)

## CI gating
- Track metrics across PRs
- Fail build if recall drops beyond threshold or critical queries regress

## Artifacts
- Store metrics + config + model versions per run
- Publish an `eval_report.json`


# 8-Week Sprint Plan

## Sprint 1 (Weeks 1–2): Foundations
Schema + migrations, ingestion + job status, incident viewer UI.

## Sprint 2 (Weeks 3–4): Search + similarity
Embeddings + vector index, keyword search + filters, similar incidents with reasons.

## Sprint 3 (Weeks 5–6): Knowledge graph v1
Entity extraction + edges with evidence pointers, graph explorer UI, patterns endpoints.

## Sprint 4 (Weeks 7–8): Quality + deploy
Eval in CI + regression gating, citations-first Q&A + refusal, rate limits, deploy + demo.


# Demo Script (5 minutes)

1. Search: “latency spike after deploy + 502s”
2. Open a top incident (impact/timeline/root cause/fix)
3. Similar incidents panel (reasons)
4. Knowledge graph (patterns + neighbors with evidence)
5. Optional Q&A (citations or refusal)


# Antigravity: 7-Agent Execution Plan

**Updated:** 2026-03-07

## Agents
1. Orchestrator/Router (Gemini)
2. Research / Source-of-truth (Gemini + browsing)
3. Architect (Gemini)
4. Backend Builder (Codex)
5. Frontend Builder (Codex or Gemini)
6. QA/Security Reviewer (Codex)
7. Release/Integrator (Gemini)

## Shared artifacts
- `docs/PROJECT_SPEC.md` (single source of truth)
- `antigravity/TASK_BOARD.json` (tickets + status)
- `antigravity/agents.yaml` (agent registry + routing)
- `docs/FILE_SCOPE_RULES.md` (agent boundaries)

## Ticket lifecycle
TODO → IN_PROGRESS → READY_FOR_REVIEW → FIX_REQUESTED → DONE

## Routing policy
- research → Research agent
- design → Architect
- backend → Backend Builder
- frontend → Frontend Builder
- review/security/perf → QA Reviewer
- release/deploy → Integrator

## Hard gates
- Every code ticket auto-creates a review ticket
- Reviewer approval required to mark DONE
- Integrator runs only when all tickets DONE

## Builder QA contract (must include in every code output)
- Run backend locally
- Check DB connectivity and migrations
- Run automated tests (unit + integration)
- Add test cases for each PR
- List risks and mitigations


# Sources (Document Resources)

**Owner:** Research (Gemini) drafts, Architect finalizes, Orchestrator locks scope.  
**Updated:** 2026-03-07

## Phase 1 sources (start here)
Pick sources that consistently include 2+ of:
- impact
- timeline
- root cause
- fix/mitigation

## Acceptance rules
Accept a source if we can reliably extract at least **2 of 4** sections and we can store the raw artifact for human review.

## Rate limiting
- Default: 1 request/second per domain
- Cache by URL hash and store fetch timestamps

## Template
- Name:
- Type: blog | statuspage | github | pdf
- Base URL:
- Example URLs (3):
- Parsing approach:
- Expected fields:
- Notes:


# File Scope Rules (Agent Boundaries)

**Updated:** 2026-03-07

## Orchestrator/Router (Gemini)
- Can edit: `antigravity/**`, `docs/**` (planning only)

## Research / Source-of-truth (Gemini + browsing)
- Can edit: `docs/SOURCES.md`, `docs/references.md`
- Cannot edit: production code

## Architect (Gemini)
- Can edit: `docs/API_SPEC.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`
- Can propose schema changes; Builder implements

## Backend Builder (Codex)
- Can edit: `apps/api/**`, `apps/worker/**`, `packages/nlp/**`, `packages/eval/**`
- `infra/**` only if a ticket requires it

## Frontend Builder (Codex/Gemini)
- Can edit: `apps/web/**`

## QA/Security Reviewer (Codex)
- Can edit: tests anywhere relevant
- Only fixes/tests/safety improvements (no new features)

## Release/Integrator (Gemini)
- Can edit: `infra/**`, `README.md`, `docs/DEPLOYMENT.md`, `docs/DEMO_SCRIPT.md`


# Step-by-Step Execution Plan (Entire Project)

**Updated:** 2026-03-07

## 0) One-time setup (Day 0)
1. Create repo skeleton: `apps/web`, `apps/api`, `apps/worker`, `packages/nlp`, `packages/eval`, `infra`, `docs`, `antigravity`
2. Copy docs from this pack into your repo `docs/`
3. Copy `antigravity/agents.yaml` and `antigravity/TASK_BOARD.json` into your repo `antigravity/`
4. Bring up Postgres + Redis (docker compose)
5. Confirm quality gate:
   - migrations apply from scratch
   - API boots
   - at least one integration test runs

## 1) How agent work runs (every day)
1. Orchestrator picks next ticket (TODO)
2. Assigned agent produces artifact (diff/notes/commands)
3. QA Reviewer tries to break it; files fix tickets if needed
4. Builder fixes; Reviewer re-checks
5. Integrator merges + updates runbook/demo if needed

## 2) Sprint 1 (Weeks 1–2): Foundations
Deliver:
- schema + migrations
- upload ingestion + job status
- parse/extract/section minimal pipeline
- incident detail UI
Tests:
- migration smoke test
- ingestion integration test

## 3) Sprint 2 (Weeks 3–4): Search + Similarity
Deliver:
- embeddings + vector store
- keyword search + filters
- hybrid search + similar incidents + reasons
Tests:
- retrieval regression (Recall@10, MRR) on seed queries

## 4) Sprint 3 (Weeks 5–6): Knowledge Graph v1
Deliver:
- entity extraction + nodes/edges with evidence pointers
- graph endpoints + graph explorer UI
Tests:
- edges must point to valid evidence sections

## 5) Sprint 4 (Weeks 7–8): Quality + Deploy
Deliver:
- eval in CI with gating
- citations-first Q&A + refusal behavior (optional)
- rate limits, retries, caching
- deploy + 5-min demo script


# References

**Updated:** 2026-03-07

Add links to official docs, papers, and key repos used for design decisions.

Each entry should include:
- Title
- Link
- Why it matters


# Contributing

## Branching
- `main` (stable)
- feature branches: `feat/<ticket-id>-<short-name>`
- hotfix branches: `fix/<ticket-id>-<short-name>`

## PR rules
- Small, atomic PRs
- One feature per PR
- Include tests for every change
- No unrelated refactors in feature PRs

## Required checks
- Lint/format
- Unit tests
- Integration tests
- Migration check (fresh DB)
- Eval regression (if search/graph changed)


# Pull Request

## Summary
- What changed?

## Tickets
- Link to TASK_BOARD ticket(s):

## How to test
- Backend:
- DB/migrations:
- Tests:

## Evidence / screenshots (if UI)
- (Attach)

## Risks
- What might break?

## Checklist
- [ ] Backend boots locally
- [ ] DB migrations apply cleanly
- [ ] Added/updated tests
- [ ] All tests pass
- [ ] Eval regression run (if search/graph impacted)


# Runbook

## Local setup (example)
- Start Postgres + Redis (docker compose)
- Apply migrations
- Run API server
- Run worker
- Run web app

## Smoke tests
- Upload document
- Ingestion job completes
- Search returns results
- Incident detail renders sections
- Similar incidents endpoint works
- Graph patterns endpoint works
- Eval run produces report


# Deployment

## Deployment checklist
- Env vars set (DB, Redis, storage, model refs)
- DB migrations applied
- Worker running
- Health checks green
- Smoke tests passed
- Rollback plan ready

## Rollback
- Revert to previous image/tag
- Prefer forward-fix migrations over rollback
