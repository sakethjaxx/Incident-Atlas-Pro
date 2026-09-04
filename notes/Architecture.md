---
aliases: [Architecture, Monorepo, System design]
tags: [project/incident-atlas-pro, architecture]
---

# Architecture

Part of [[Incident Atlas Pro]].

## Monorepo (pnpm workspace, root = `incident-ingest/`)

| Package | Stack | Job |
|---|---|---|
| `apps/api` | Express, ESM, **no TypeScript** | HTTP API — ingest, search, QA, graph, eval, audit |
| `apps/web` | Vite + React 18 + TS, React Router v6, TanStack Query v5 | SPA — Dashboard, Search, Ask (QA), Incident detail, Graph viz, Upload |
| `apps/worker` | BullMQ + Redis | async ingestion jobs (parse → embed → chunk → extract graph) |
| `packages/nlp` | pure Node, zero-dep core | all model access + text ops: [[embeddings]], chunking, [[RRF fusion]], [[reranker]], [[Knowledge Graph\|graph extract]], [[TurboQuant]], provider config |
| `packages/db` | Prisma + raw SQL | retrieval queries ([[Hybrid retrieval]]), storage, graph reads |

> [!info] Two entry files, one is live
> `apps/api/src/app.js` (via `server.js`) is the **real** server that tests import. An older `index.js` exists with some fixes that were re-applied to `app.js`. When editing API wiring, edit `app.js`.

## Request surface (routers mounted in `app.js`)

`health` · `sources` · `documents` · `ingest` · `incidents` · `search` · `graph` · `eval` · `qa` · `jobs` · `metadata`

Key endpoints: `POST /ingest/manual`, `POST /ingest/upload`, `GET /search`, `POST /qa` ([[Citations-first QA]]), `GET /incidents/:id/similar` ([[Similar incidents]]), `GET /graph/patterns`, `GET /graph/neighbors`, `GET /eval/latest`.

## Cross-cutting

- **Auth**: bearer token middleware (`requireQa`, admin token). *Not* real multi-tenancy — see [[Pitch caveats and gaps]].
- **Rate limits**: per-route, env-overridable (`INGEST/QA/READ_RATE_LIMIT_PER_MIN`).
- **CORS**: locked to one origin (`CORS_ORIGIN`, default `localhost:5173`).
- **Audit log**: every QA answer/refusal writes an `AuditLog` row (input/output hashes, retrieved ids, refusal code) — see [[Data model]].
- **Logging**: pino / pino-http.

## Local dev
```bash
pnpm db:up        # Postgres (docker compose) — required before API
pnpm dev          # api :3001 + web :5173
pnpm api:migrate  # prisma migrate dev
pnpm test         # vitest (integration needs db:up)
```

See also: [[Data model]] · [[Open-source RAG stack]] · [[RAG]]
