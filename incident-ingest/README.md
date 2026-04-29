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

**Sprint 1:** ✅ **COMPLETE**
**Sprint 2:** ✅ **COMPLETE** — Retrieval pipeline (embeddings, keyword/vector search, similar incidents) shipped and verified

### Sprint 2 — All tickets DONE

| Ticket | Title | Status |
|--------|-------|--------|
| S2-PLAN-001 | Create Sprint 2 plan | ✅ DONE |
| S2-RES-001 | Research retrieval stack | ✅ DONE |
| S2-ARCH-001 | Freeze Sprint 2 contract | ✅ DONE |
| W2-003 | Retrieval foundation (embeddings, pgvector) | ✅ DONE |
| W2-003-QA | QA review: retrieval foundation | ✅ DONE |
| W2-004 | Search and similar APIs with scored evidence | ✅ DONE |
| W2-004-QA | QA review: retrieval APIs | ✅ DONE |
| W2-005 | Search UI and similar-incident panel integration | ✅ DONE |
| W2-005-QA | QA review: retrieval UX | ✅ DONE |
| Sprint2-Release | Smoke tests + doc sync | ✅ DONE |

### Test results (2026-04-29)

| Suite | Tests | Result |
|-------|-------|--------|
| `@pkg/nlp` | 40 | ✅ all green |
| `@app/worker` unit | 53 | ✅ all green |
| `@app/api` unit | 2 | ✅ all green |
| `@app/api` integration | 82 | ✅ all green |

## Run locally

1. Start infrastructure

```bash
docker compose up -d
```

2. Install dependencies

```bash
pnpm install
```

3. Configure environment files

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

4. Run migrations

```bash
pnpm api:migrate
```

5. Start the API and web app

```bash
pnpm dev
```

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
- `/upload` async file upload with job status polling

API endpoints:

- `GET /health` liveness check
- `POST /ingest/upload` multipart txt/md upload → enqueue parse job → returns `{ jobId, documentId }`
- `POST /ingest/manual` synchronous raw text ingest → returns full incident
- `POST /ingest/:documentId` enqueue job for previously uploaded document
- `GET /jobs/:jobId` poll async job status (rate-limited)
- `GET /incidents` list incidents
- `GET /incidents/:id` incident with sections
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

## Roadmap

- Sprint 2: keyword search, embeddings, similarity endpoints, and search UI
- Sprint 3: entity extraction, graph APIs, and graph explorer UI
- Sprint 4: eval harness, citations-first Q&A, auth/rate limits, deployable demo

## Project docs

- [Project plan](./docs/PROJECT_PLAN.md)
- [Project spec](./docs/PROJECT_SPEC.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [API spec](./docs/API_SPEC.md)
- [Data model](./docs/DATA_MODEL.md)
