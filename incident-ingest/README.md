# Incident Atlas Pro

Incident Atlas Pro is an incident-intelligence system for turning raw postmortems, outage reports, and incident notes into structured operational knowledge.

The MVP is being built as an 8-week roadmap across four sprints:

- Sprint 1: foundations for schema, ingestion, async processing, and web UI
- Sprint 2: search and similarity with keyword plus vector retrieval
- Sprint 3: knowledge graph extraction and graph exploration
- Sprint 4: evals, Q&A, rate limits, deployment, and demo readiness

## What the project solves

During incidents, teams lose time searching scattered knowledge across postmortems, runbooks, status pages, and internal notes. Incident Atlas Pro is designed to answer:

- Have we seen this incident pattern before?
- What symptoms, triggers, and root causes tend to show up together?
- Which fixes actually worked in similar incidents?

## Current stack

- Node.js + Express
- Vite + React 18
- PostgreSQL + Prisma
- BullMQ + Redis
- pgvector

## Current status

**Sprint 1:** COMPLETE
**Sprint 2:** COMPLETE - retrieval pipeline shipped and verified
**Sprint 3:** COMPLETE - graph extraction, graph APIs, and graph UI shipped and smoke-tested
**Sprint 4:** COMPLETE - evaluation harness, citations-first Q&A, and security/rate limits shipped

### Sprint 4 - All tickets DONE

| Ticket | Title | Status |
|--------|-------|--------|
| S4-PLAN-001 | Create Sprint 4 plan | DONE |
| S4-RES-001 | Research eval metrics and Q&A | DONE |
| S4-ARCH-001 | Freeze Sprint 4 eval, Q&A, auth contracts | DONE |
| W4-001 | Evaluation harness and regression gate | DONE |
| W4-001-QA | QA review: evaluation harness | DONE |
| W4-002 | Citations-first Q&A API and audit logging | DONE |
| W4-002-QA | QA review: citations-first Q&A | DONE |
| W4-003 | Auth, rate limits, and audit hardening | DONE |
| W4-003-QA | QA review: auth, rate limits, audit | DONE |
| W4-004 | Q&A UI and eval reports UI | DONE |
| W4-004-QA | QA review: Q&A UI | DONE |
| Sprint4-Release | Smoke tests + doc sync | DONE |

### Release evidence (2026-05-13)

| Suite | Tests | Result |
|-------|-------|--------|
| `@pkg/nlp` Sprint 4 QA | 83 | all green |
| `@app/worker` Sprint 4 QA | 66 | all green |
| `@app/api` Sprint 4 QA | 146 | all green |
| `scripts/smoke-test.sh` | e2e Sprint 4 smoke | ingest, retrieval, graph, eval latest, QA citation/refusal path verified |

## Run locally

1. Start shared infrastructure only

```bash
docker compose up -d db redis minio
```

2. Install dependencies

```bash
pnpm install
```

3. Configure environment files

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/worker/.env.example apps/worker/.env
```

4. Run migrations

```bash
pnpm api:migrate
```

5. Start the app locally

```bash
pnpm dev
```

Note: `docker-compose.yaml` also defines `api` and `worker`. If you already ran
`docker compose up -d` without service names, stop those containers before
starting `pnpm dev` or the local API will conflict on port `3001`.

Local services:

- API: `http://localhost:3001`


- Web: `http://localhost:5173`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Available today

Web routes:

- `/` dashboard
- `/incidents` incident list
- `/incidents/:id` incident detail
- `/graph` interactive knowledge graph patterns browser (force-directed)
- `/upload` async single-file or batch upload with job status polling
- `/search` hybrid search with context-aware smart filters and autocomplete

API endpoints:

- `GET /health` liveness check
- `POST /ingest/upload` multipart txt/md upload(s) -> enqueue one parse job per file -> returns `{ accepted, uploads }`
- `POST /ingest/:documentId` enqueue job for previously uploaded document
- `GET /jobs/:jobId` poll async job status (rate-limited)
- `GET /incidents` list incidents
- `GET /incidents/:id` incident with sections
- `GET /search?q=...` hybrid keyword + vector search
- `GET /incidents/:id/similar` similar incidents with evidence
- `GET /graph/patterns?service=...&symptom=...` recurring extracted graph patterns
- `GET /graph/neighbors?node_id=...&depth=1` adjacent graph nodes and evidence-backed edges
- `GET /documents` list uploaded documents
- `GET /sources` list sources
- `POST /sources` create source (admin auth)

## Manual ingest example

`POST http://localhost:3001/ingest/manual`

```json
{
  "title": "Payments outage",
  "company": "ExampleCo",
  "date": "2026-01-28T10:30:00Z",
  "rawText": "Impact:\nCheckout failed for 32 minutes.\n\nTimeline:\n10:03 UTC alarms fired.\n10:22 UTC rollback complete.\n\nRoot Cause:\nBad deploy to payment-service.\n\nFix:\nPin dependency + add canary."
}
```

Manual ingest now also runs graph extraction after embeddings. Shipped Sprint 3 graph nodes are `service`, `symptom`, `root_cause`, and `fix`; shipped graph edge types are `AFFECTS`, `HAS_SYMPTOM`, `CAUSED_BY`, and `RESOLVED_BY`. Every graph edge includes `evidence_section_id`, which maps back to an incident detail anchor shaped as `#section-{type}-{sectionId}`.

## Sprint 3 graph smoke

With the API and worker running, the canonical release smoke is:

```bash
bash scripts/smoke-test.sh
```

The script verifies upload/job health from the existing smoke path, then creates a deterministic `payment-api` incident through `POST /ingest/manual`, queries `GET /graph/patterns`, traverses `GET /graph/neighbors`, and verifies that at least one graph edge points to a section anchor on the incident detail page.

## Roadmap

- Sprint 1: schema, ingestion, async processing, and web UI - complete
- Sprint 2: keyword search, embeddings, similarity endpoints, and search UI - complete
- Sprint 3: entity extraction, graph APIs, and graph explorer UI - complete
- Sprint 4: eval harness, citations-first Q&A, auth/rate limits, deployable demo

## Project docs

- [Project plan](./docs/PROJECT_PLAN.md)
- [Project documentation](./docs/PROJECT_DOCUMENTATION.md)
- [Project spec](./docs/PROJECT_SPEC.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [API spec](./docs/API_SPEC.md)
- [Data model](./docs/DATA_MODEL.md)
