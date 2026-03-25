# Incident Atlas Pro - Runbook

## Overview
This runbook provides instructions for deploying, operating, evaluating, and troubleshooting the Incident Atlas Pro application. This system features an Incident Knowledge Graph (IKG) and Hybrid Retrieval.

## Prerequisites
- Node.js (v18+)
- pnpm (v8+)
- PostgreSQL (v15+) with pgvector
- Redis (for caching and backend worker queues)

## Local Setup (Development)
1. **Start Services:** Start Postgres and Redis via Docker Compose.
   ```bash
   docker compose up -d
   ```
2. **Install Dependencies:**
   ```bash
   pnpm install
   ```
3. **Database Migrations:** Apply migrations from scratch.
   ```bash
   cd apps/api
   pnpm run db:migrate
   ```
4. **Environment Variables:** Ensure `.env` files are configured in `apps/api` and `apps/web`. The Gemini API key must be set for extraction/embeddings if not using local mock models.

## Running the Application
To start the entire stack simultaneously:
```bash
pnpm run dev
```
Alternatively, run components individually:
- **API Server:** `cd apps/api && pnpm run dev`
- **Worker (Ingestion Jobs):** `cd apps/worker && pnpm run dev`
- **Web App:** `cd apps/web && pnpm run dev`

## Quality Gates & Smoke Tests
Before merging or deploying, the Integrator must verify the following smoke tests pass:
1. **Backend & DB Checks:**
   - Fresh DB migrates cleanly without errors.
   - `apps/api` boots up and DB connectivity is confirmed.
2. **End-to-End Core Flows:**
   - **Upload Document:** Feed a raw document (Markdown/PDF/HTML).
   - **Job Completion:** The ingestion job must complete successfully in the worker logs.
   - **Search Results:** Hybrid search (vector + keyword) returns results matching the ingested incident.
   - **Detail View:** Incident detail view properly renders the extracted sections (impact, timeline, root cause, mitigation).
   - **Similar Incidents:** The similar incidents endpoint works and provides "reasons".
   - **Knowledge Graph:** Graph pattern endpoint returns valid nodes and edges with evidence pointers.
3. **Evaluation Harness:**
   - Run the eval script to ensure retrieval regression hasn't occurred (tracking MRR, Recall@K on seed queries).
   ```bash
   cd packages/eval
   pnpm run eval
   ```

## Deployment Checklist
- [ ] Database (Postgres w/ pgvector) and Redis provisioned and secured.
- [ ] Environment variables injected into CI/CD and production clusters.
- [ ] DB Migrations run automatically or as a pre-deploy step.
- [ ] Worker processes appropriately scaled based on expected ingestion load.
- [ ] Rate limits configured on APIs (scraping and Q&A).
- [ ] Basic authentication implemented on admin ingestion endpoints.

## Troubleshooting
### Ingestion Pipeline Stalled
- **Symptom:** Incident uploaded but status hangs.
- **Action:** Check Redis connectivity. Inspect the worker process logs in `apps/worker`. Verify parsing or Gemini API rate limits/errors.

### Empty Search Results
- **Symptom:** Searches return nothing despite successful ingestion.
- **Action:** Ensure pgvector is enabled. Check if vector embeddings were appropriately generated and saved in the database. 
