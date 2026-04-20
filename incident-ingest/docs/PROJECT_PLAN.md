# Incident Atlas Pro - Project Plan

> **Stack:** Node.js + Express, Vite + React, PostgreSQL + Prisma, BullMQ + Redis, pgvector
> **Workspace:** `incident-ingest/`

## Roadmap Overview

| Sprint | Scope | Status |
|--------|-------|--------|
| Sprint 1 | Foundations: schema, ingest API, async worker, web UI, deployment artifacts | Complete |
| Sprint 2 | Search + similarity: embeddings, vector index, keyword filters, search UI | In progress |
| Sprint 3 | Knowledge graph v1: entity extraction, graph APIs, graph explorer UI | Planned |
| Sprint 4 | Quality + deploy: eval harness, Q&A, auth/rate limits, demo readiness | Planned |

## Sprint 1 - Foundations

Sprint 1 established the product foundation:

- Prisma schema and migrations for sources, documents, jobs, incidents, and sections.
- Multipart incident upload and manual raw-text ingest endpoints.
- BullMQ parse queue and Redis-backed async worker.
- Shared NLP package for section extraction and summary generation.
- Job status endpoint for queued, active, completed, and failed ingest jobs.
- React routes for dashboard, incident list, incident detail, and upload flows.
- Local and production-style Docker Compose configurations.
- Production API and worker Dockerfiles with health checks and persistent volumes.

## Sprint 2 - Search + Similarity

Sprint 2 expands the product from structured storage into retrieval:

- Enable pgvector-backed embeddings in PostgreSQL.
- Generate embeddings for incident summaries and sections.
- Add keyword and metadata search across incident records.
- Add similar-incident retrieval based on vector distance.
- Build search UI and similar-incident panels in the web app.
- Keep incident creation resilient when embedding generation fails.

## Sprint 3 - Knowledge Graph

Sprint 3 introduces graph-style incident exploration:

- Extract services, symptoms, triggers, root causes, and fixes from incident sections.
- Store graph nodes and edges with evidence pointers.
- Add graph query APIs for patterns and neighboring entities.
- Build a graph explorer UI with incident and evidence side panels.

## Sprint 4 - Quality + Demo Readiness

Sprint 4 focuses on reliability, evaluation, and demo polish:

- Add an evaluation harness for search and retrieval quality.
- Add citations-first Q&A over incident sections.
- Add stricter auth and rate limiting for production endpoints.
- Finalize deployment, monitoring, runbook, and demo flow.

## Environment Quick Reference

| Service | Port | Notes |
|---------|------|-------|
| PostgreSQL | 5432 | Local development database |
| Redis | 6379 | Local queue backend |
| API | 3001 | Express API |
| Web | 5173 | Vite dev server |

Env files to copy before first run:

- `apps/api/.env` from the API env example.
- `apps/web/.env` from the web env example.
- `.env.prod` from `.env.prod.example` for production-style Compose.
