# Sprint 2 Plan

**Kickoff date:** 2026-04-20
**Sprint theme:** Search + similarity
**Primary outcome:** turn the Sprint 1 incident store into a retrieval workflow with scored search results, evidence sections, and similar-incident recommendations.
**Current active ticket:** `W2-003`

## Agent map

This plan is derived from `docs/antigravity/agents.yaml`.

| Agent | Responsibility in Sprint 2 |
|------|------|
| `orchestrator_router` | break work into tickets, route dependencies, keep board current |
| `research_sot` | recommend embedding/reranking options and source-of-truth references |
| `architect` | freeze schema/API/retrieval contracts before builder work spreads |
| `backend_builder` | implement pgvector, indexing, search APIs, similarity APIs, tests |
| `frontend_builder` | build search route, result cards, evidence rendering, similar panel |
| `qa_security` | paired review tickets for every code ticket, perf/security/test-gap review |
| `release_integrator` | doc sync, demo path, smoke tests, release readiness |

## Sprint 2 tickets

| Ticket | Owner | Status | Depends on | Goal |
|------|------|------|------|------|
| `S2-PLAN-001` | `orchestrator_router` | `DONE` | - | publish Sprint 2 plan and create the task set |
| `S2-RES-001` | `research_sot` | `DONE` | `S2-PLAN-001` | lock the recommended retrieval stack and fallback strategy |
| `S2-ARCH-001` | `architect` | `DONE` | `S2-PLAN-001`, `S2-RES-001` | freeze schema, API, ranking, and failure contracts |
| `W2-003` | `backend_builder` | `TODO` | `S2-ARCH-001` | ship pgvector migration, embedding persistence, and reindex/backfill support |
| `W2-003-QA` | `qa_security` | `TODO` | `W2-003` | verify migration safety, failure handling, and backfill behavior |
| `W2-004` | `backend_builder` | `TODO` | `W2-003` | ship `/search` and `/incidents/:id/similar` with scores, filters, and evidence |
| `W2-004-QA` | `qa_security` | `TODO` | `W2-004` | review ranking quality, edge cases, and perf guardrails |
| `W2-005` | `frontend_builder` | `TODO` | `S2-ARCH-001`, `W2-004` | ship search UI and wire the incident detail similar panel |
| `W2-005-QA` | `qa_security` | `TODO` | `W2-005` | verify loading, empty, error, and deep-link flows |
| `Sprint2-Release` | `release_integrator` | `TODO` | `W2-003-QA`, `W2-004-QA`, `W2-005-QA` | sync docs, run smoke tests, and mark Sprint 2 ready |

## Ticket details

### `S2-PLAN-001` - Sprint 2 routing and board setup
- Owner: `orchestrator_router`
- Scope:
  - `incident-ingest/docs/SPRINT_2_PLAN.md`
  - `incident-ingest/docs/antigravity/TASK_BOARD.json`
  - `incident-ingest/docs/antigravity/agents.yaml`
- Acceptance criteria:
  - Sprint 2 tickets exist with owners, dependencies, and statuses.
  - Every code ticket has a paired QA ticket.
  - The agent registry is complete enough to assign all Sprint 2 work.

### `S2-RES-001` - Retrieval stack recommendation
- Owner: `research_sot`
- Scope:
  - `incident-ingest/docs/references.md`
  - `incident-ingest/docs/SOURCES.md`
- Acceptance criteria:
  - Recommend the primary embeddings path, fallback path, and optional reranker.
  - Document expected dimension size, latency/cost tradeoffs, and local-dev fallback.
  - Provide sources the architect can cite in the final contract.

### `S2-ARCH-001` - Freeze Sprint 2 retrieval contract
- Owner: `architect`
- Scope:
  - `incident-ingest/docs/API_SPEC.md`
  - `incident-ingest/docs/DATA_MODEL.md`
  - `incident-ingest/docs/ARCHITECTURE.md`
- Acceptance criteria:
  - Define search response shape, similar-incident response shape, and evidence contract.
  - Define schema changes for incident and section embeddings plus indexing strategy.
  - Define how ingest behaves when embedding generation fails or needs backfill.

### `W2-003` - Retrieval foundation
- Owner: `backend_builder`
- Scope:
  - `incident-ingest/apps/api/prisma/**`
  - `incident-ingest/apps/api/src/lib/**`
  - `incident-ingest/apps/worker/**`
  - `incident-ingest/packages/nlp/**`
- Acceptance criteria:
  - pgvector migration applies cleanly from scratch.
  - New incidents and sections receive embeddings or degrade safely without blocking ingest.
  - A reindex/backfill path exists for Sprint 1 incidents already in the database.
- Tests required:
  - migration smoke
  - ingest-manual embedding path
  - worker embedding path
  - backfill/reindex smoke test

### `W2-003-QA` - QA review: retrieval foundation
- Owner: `qa_security`
- Acceptance criteria:
  - Verify missing embedding provider does not break incident creation.
  - Verify migrations are reversible enough for local recovery and safe on existing data.
  - Verify reindex/backfill can be resumed after partial failure.

### `W2-004` - Search and similar APIs
- Owner: `backend_builder`
- Scope:
  - `incident-ingest/apps/api/src/routes/search.js`
  - `incident-ingest/apps/api/src/routes/incidents.js`
  - `incident-ingest/apps/api/src/tests/**`
- Acceptance criteria:
  - `/search` returns ranked incidents, scores, filters, and matched evidence sections.
  - `/incidents/:id/similar` returns top matches with human-readable reasons.
  - API behavior is deterministic enough for automated integration tests.
- Tests required:
  - search keyword match
  - search filters
  - no-result path
  - similar incident relevance
  - 404 and malformed-input coverage

### `W2-004-QA` - QA review: retrieval APIs
- Owner: `qa_security`
- Acceptance criteria:
  - Verify search does not over-return unrelated incidents for narrow queries.
  - Verify similar reasons prioritize evidence overlap over weak metadata matches.
  - Verify API latency and pagination stay acceptable on a seeded dataset.

### `W2-005` - Search UI and similarity panel
- Owner: `frontend_builder`
- Scope:
  - `incident-ingest/apps/web/**`
- Acceptance criteria:
  - Add a dedicated `/search` route with query input, filters, and ranked result cards.
  - Show matched evidence snippets in results.
  - Replace the incident detail similarity placeholder with live data.
- Tests required:
  - web build
  - manual smoke test with API + worker running

### `W2-005-QA` - QA review: retrieval UX
- Owner: `qa_security`
- Acceptance criteria:
  - Verify loading, empty, error, and success states.
  - Verify deep links from search results and similar incidents land on valid detail pages.
  - Verify filter state and responsive layout remain usable on mobile and desktop.

### `Sprint2-Release` - Sprint 2 release readiness
- Owner: `release_integrator`
- Scope:
  - `incident-ingest/README.md`
  - `incident-ingest/docs/API_SPEC.md`
  - `incident-ingest/docs/RUNBOOK.md`
  - `incident-ingest/docs/DEMO_SCRIPT.md`
  - `incident-ingest/docs/PROJECT_PLAN.md`
  - `incident-ingest/docs/antigravity/TASK_BOARD.json`
- Acceptance criteria:
  - README and docs describe the shipped retrieval workflow.
  - Smoke test covers upload, indexing, search, similar incidents, and detail navigation.
  - Sprint 2 board state is updated from actual QA outcomes, not intent.

## Execution order

### Phase 0 - coordination
1. `S2-PLAN-001`
2. `S2-RES-001`
3. `S2-ARCH-001`

### Phase 1 - foundation
4. `W2-003`
5. `W2-003-QA`

### Phase 2 - user-facing retrieval
6. `W2-004`
7. `W2-005`
8. `W2-004-QA`
9. `W2-005-QA`

### Phase 3 - release
10. `Sprint2-Release`

## Recommended sprint cadence

### Week 3
- freeze retrieval contract
- land migration/indexing/backfill
- land search + similarity APIs

### Week 4
- land search UX and similar panel
- run QA review tickets
- sync docs and demo flow

## Risks to watch

1. `agents.yaml` drift:
   release ownership was missing from the registry and has now been aligned.
2. retrieval quality drift:
   keep API tests seeded with representative incidents so ranking changes are visible.
3. embedding dependency risk:
   require a local fallback so dev and CI are not blocked by external model access.
4. backfill blast radius:
   reindex existing Sprint 1 incidents in batches and make the job resumable.
