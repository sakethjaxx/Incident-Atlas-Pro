# Incident Atlas Pro

Incident Atlas Pro is an incident-intelligence platform that turns raw postmortems, outage reports, and operational notes into structured, searchable incident knowledge.

It helps engineering, SRE, platform, and operations teams preserve what happened during incidents, organize the lessons learned, and make past failures easier to discover when similar symptoms appear again.

## What It Does

Incident Atlas Pro ingests incident text files, parses them asynchronously, and presents the result as structured incident records.

Core capabilities include:

- Upload incident reports through a web UI.
- Process uploads asynchronously with a queue worker.
- Extract structured sections such as impact, timeline, root cause, and mitigation.
- Track ingestion jobs while they move through the queue.
- Browse incidents and inspect their parsed sections.
- Store incident data in PostgreSQL with a Prisma-backed schema.
- Run locally or through production-style Docker Compose services.

## Why It Matters

Incident knowledge is often scattered across documents, tickets, Slack threads, dashboards, and runbooks. That makes it hard to answer practical questions during future investigations:

- Has this failure pattern happened before?
- What was the root cause last time?
- Which mitigation actually worked?
- Which systems or symptoms tend to appear together?
- Where is the evidence behind a previous decision?

Incident Atlas Pro centralizes incident records so past operational knowledge can be searched, reviewed, and reused.

## Current Features

### Ingestion

- Multipart file upload for incident reports.
- Manual raw-text ingest endpoint.
- Async queue-based parsing using BullMQ and Redis.
- Job status endpoint for upload progress and completion state.

### Parsing

- Shared NLP package for lightweight section extraction.
- Support for common incident sections:
  - impact
  - timeline
  - root cause
  - fix / mitigation
- Summary generation for incident text.

### Web App

- Dashboard route.
- Incident list view.
- Incident detail view.
- Upload page with job polling and completion feedback.
- Error boundary and inline network-error states.

### Infrastructure

- Express API.
- BullMQ worker service.
- PostgreSQL database.
- Redis queue.
- Prisma schema and migrations.
- Local Docker Compose setup.
- Production Dockerfiles for API and worker.
- Production Compose file with health checks and persistent volumes.

## Tech Stack

- Node.js
- Express
- Vite
- React
- PostgreSQL
- Prisma
- Redis
- BullMQ
- Docker Compose
- pgvector-ready database image

## Repository Layout

```text
Incident-Atlas-Pro/
  incident-ingest/
    apps/
      api/          Express API, routes, Prisma schema, migrations
      worker/       BullMQ worker for async parsing
      web/          React frontend
    packages/
      nlp/          Shared parsing and summarization package
    docs/           Architecture, API, deployment, runbook, sprint docs
```

## Run Locally

The application workspace is in `incident-ingest/`.

```bash
cd incident-ingest
pnpm install
docker compose up -d --wait
pnpm api:migrate
pnpm dev
```

Local URLs:

- API: `http://localhost:3001`
- Web: `http://localhost:5173`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Run Tests

```bash
cd incident-ingest
pnpm test:unit
```

The unit test suite covers the shared NLP package, API health route, and worker parsing/heartbeat behavior.

## Production-Style Compose

The production compose file is available at:

```text
incident-ingest/docker-compose.prod.yml
```

To run it:

```bash
cd incident-ingest
cp .env.prod.example .env.prod
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build --wait
```

The production-style stack includes:

- PostgreSQL with persistent volume.
- Redis with AOF persistence and BullMQ-safe `noeviction` policy.
- API container with `/health` check.
- Worker container with heartbeat-based health check.
- Persistent upload volume.
- Restart policies for long-running services.

## Documentation

- [Incident Ingest README](./incident-ingest/README.md)
- [Architecture](./incident-ingest/docs/ARCHITECTURE.md)
- [API Spec](./incident-ingest/docs/API_SPEC.md)
- [Data Model](./incident-ingest/docs/DATA_MODEL.md)
- [Runbook](./incident-ingest/docs/RUNBOOK.md)
- [Deployment Readiness](./incident-ingest/docs/DEPLOYMENT_READINESS.md)

## Status

Please see the `incident-ingest/README.md` file for the latest project status, feature set, and sprint completion updates.
