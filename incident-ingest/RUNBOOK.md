# Incident Atlas Pro - Runbook

## Overview
This runbook provides instructions for deploying, operating, and troubleshooting the Incident Atlas Pro application.

## Prerequisites
- Node.js (v18+)
- pnpm (v8+)
- PostgreSQL (v15+)
- Redis (optional, for caching/queues if needed)

## Environment Setup
1. Clone the repository and install dependencies:
   ```bash
   pnpm install
   ```
2. Configure environment variables in `apps/api/.env` and `apps/web/.env`.
   - Ensure database connection string is set (`DATABASE_URL`).
   - Ensure required API keys (e.g., Gemini) are present.

## Database Migrations
To run schema migrations on a fresh or existing database:
```bash
cd apps/api
pnpm run db:migrate
```

## Running the Application Locally
To start the entire stack (API, Web, and Worker/Jobs):
```bash
pnpm run dev
```
- The Web frontend will be accessible at http://localhost:3000
- The API backend will be accessible at http://localhost:3001

## Smoke Tests & Quality Gates
Before deploying or merging major changes, ensure all tests pass.
- Run unit/integration tests: `pnpm run test`
- Run linting: `pnpm run lint`
- Run DB smoke tests (verifying connectivity and schema migrations): `pnpm run db:test`

## Deployment Checklist
- [ ] Environment variables configured correctly in the target environment
- [ ] Database credentials and network access properly secured
- [ ] Database migrations executed successfully
- [ ] API backend deployed and healthy (`/health` endpoint returns 200)
- [ ] Ingestion worker/queues configured and processes started
- [ ] Web frontend built (`pnpm run build`) and deployed statically or via standard node hosting
- [ ] End-to-end smoke test completed on production/staging

## Troubleshooting
### Ingestion Jobs Failing
- **Symptom:** Incidents uploaded but not showing up in search.
- **Action:** Check the worker logs. Verify API keys for extraction services. Check database connectivity.

### Search Not Returning Results
- **Symptom:** Hybrid search and full-text search return empty lists for known incidents.
- **Action:** Ensure vector embeddings were successfully generated during ingestion. Check vector store connectivity/indexes in the database.
