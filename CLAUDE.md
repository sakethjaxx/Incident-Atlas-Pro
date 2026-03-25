# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

All active code lives under `incident-ingest/` — a **pnpm workspace** with two apps:

- `apps/api/` — Node.js + Express backend (ESM, no TypeScript)
- `apps/web/` — Vite + React 18 SPA (TypeScript, React Router v6, TanStack Query v5)

Docs and planning materials live in `incident-ingest/docs/`.

## Development Commands

All commands run from `incident-ingest/`:

```bash
# Start PostgreSQL (required before API)
pnpm db:up          # docker compose up -d
pnpm db:down        # docker compose down

# Install dependencies
pnpm install

# Run all services concurrently
pnpm dev            # starts both api (port 3001) and web (port 5173)

# Run individually
pnpm --filter @app/api dev
pnpm --filter @app/web dev

# Prisma
pnpm api:migrate    # prisma migrate dev
pnpm api:generate   # prisma generate

# Web build
pnpm --filter @app/web build
```

No test suite exists yet.

## Environment Setup

Copy `.env.example` → `.env` in each app before first run:

- `apps/api/.env`: `DATABASE_URL`, `PORT=3001`
- `apps/web/.env`: `VITE_API_URL=http://localhost:3001`

Default Postgres credentials (from docker-compose): `postgres/postgres`, db `incident_ingest`, port `5432`.

## Architecture

### Data Model (`apps/api/prisma/schema.prisma`)

Two Prisma models backed by PostgreSQL:
- **Incident** — UUID PK, title, date, company, severity, tags (String[]), summaryText, 1:N relation to sections
- **Section** — UUID PK, incidentId FK (cascade delete), type (`SectionType` enum: `impact | timeline | rootcause | fix`), text

### API (`apps/api/src/index.js`)

Express server with three endpoints:
- `POST /ingest/manual` — accepts `{ title, company, date, rawText, severity?, tags? }`, auto-parses rawText into typed sections, generates a 280-char summary, persists via Prisma, returns the full incident + sections
- `GET /incidents` — list all incidents
- `GET /incidents/:id` — incident with sections

**Section parsing heuristic**: scans lines for known labels (e.g., "impact", "timeline", "root cause", "fix") and groups following lines into sections. Falls back to paragraph chunking, then to a single "impact" section.

### Web SPA (`apps/web/src/`)

- `main.tsx` — entry point; wraps with `<BrowserRouter>` + `<QueryClientProvider>`
- `App.tsx` — route table (`/`, `/incidents`, `/incidents/:id`, `/upload`)
- `lib/api.ts` — typed fetch wrapper; all API calls go through here
- `routes/` — one component per route; each uses `useQuery` / `useMutation` from TanStack Query

### Planned (not yet implemented)

Per `docs/ARCHITECTURE.md` and `docs/SPRINT_PLAN.md`: embedding pipeline, vector search, graph extraction, Redis worker queues, S3/minio storage, LLM-powered Q&A.
