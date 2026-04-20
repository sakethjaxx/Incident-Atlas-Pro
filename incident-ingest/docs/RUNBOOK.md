# Incident Atlas Pro — Runbook (Sprint 1)

> **Last updated:** 2026-04-20  
> **Status:** ✅ Sprint 1 complete and verified — 124 tests passing, all Docker healthchecks green

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | v20+ |
| pnpm | v9+ |
| Docker (Desktop or Engine) | v24+ |
| Docker Compose (plugin) | v2.27+ |

---

## Local Setup

### 1. Start infrastructure (Postgres + Redis)
```bash
# From incident-ingest/
docker compose up -d --wait
# Expected: db → healthy, redis → healthy
```

### 2. Install dependencies
```bash
pnpm install
```

### 3. Apply database migrations (fresh schema)
```bash
pnpm run api:migrate
# Alias: pnpm --filter @app/api prisma:migrate
```

### 4. (Optional) Generate Prisma client
```bash
pnpm run api:generate
```

---

## Running the Application

### Full stack (API + Worker)
```bash
pnpm run dev          # starts all workspaces with node --watch
```

### Individual components
```bash
# API server (port 3001)
pnpm --filter @app/api dev

# Background worker
pnpm --filter @app/worker dev

# Web UI (port 3000)
pnpm --filter @app/web dev
```

### Worker via Docker
```bash
# Build and start only the worker container (db + redis boot first)
docker compose up worker
```

---

## Quality Gates & Smoke Tests

Run in order before any merge or deployment:

### Step 1 — Unit tests (no DB/Redis required)
```bash
pnpm --filter @pkg/nlp test           # 40 NLP tests
pnpm --filter @app/worker test        # 29 worker unit tests (health, processor, resolve_text, shutdown)
pnpm --filter @app/api test:unit      # 2 API health tests
```
**Expected:** all green.

### Step 2 — Integration tests (requires running Postgres)
```bash
docker compose up -d --wait
pnpm --filter @app/api test:integration
```
**Expected:** migration smoke + upload/job/incident CRUD tests pass.

### Step 3 — Manual e2e upload smoke
```bash
# Terminals A and B
pnpm --filter @app/api dev
pnpm --filter @app/worker dev

# Terminal C — upload a test doc
curl -X POST http://localhost:3001/ingest/upload \
  -F "file=@test-incident.txt" | jq .
# → { "jobId": "<uuid>", "documentId": "<uuid>", ... }

# Poll until completed
curl http://localhost:3001/jobs/<jobId> | jq .
# → { "status": "completed", "result": { "incidentId": "<uuid>" } }

# Verify incident stored with sections
curl http://localhost:3001/incidents/<incidentId> | jq .
# → full incident object with sections[]
```

### Step 4 — Worker healthcheck (Docker only)
```bash
docker compose up -d --wait
# After ~15s start_period the healthcheck kicks in.
docker inspect --format='{{.State.Health.Status}}' incident_ingest_worker
# → "healthy"
```

---

## Deployment Checklist (Sprint 1) — Verified 2026-04-20

- [x] `docker compose up -d --wait` shows db + redis + worker all **healthy**
- [x] `pnpm run api:migrate` runs cleanly from a fresh schema
- [x] Unit tests pass — 40 NLP + 29 worker + 2 API = 71 unit tests green
- [x] Integration tests pass — 53/53 green
- [x] Manual upload → job → incident e2e smoke passes (Step 3 above)
- [x] `ADMIN_TOKEN` + `VITE_ADMIN_TOKEN` documented in `.env.example` files
- [x] Rate limits active on `/jobs/:jobId` (express-rate-limit v8, req.ip keygen)
- [x] Worker heartbeat healthcheck confirmed healthy in Docker
- [x] `scripts/smoke-test.sh` available for repeatable e2e verification

---

## Worker Liveness — How it works

The worker writes `/tmp/worker-heartbeat.json` every **10 seconds** while connected.  
The Docker healthcheck (`docker-compose.yaml`) tests that the file is less than 30 seconds old.  
If Redis is lost and the retry strategy exhausts 10 attempts, the worker calls `shutdown("redis-exhausted")` and exits—Docker restarts it automatically (`restart: unless-stopped`).

---

## Troubleshooting

### Worker zombie (connected but not processing)
- **Symptom:** `docker inspect incident_ingest_worker` shows `unhealthy`.
- **Action:** Container will restart automatically. Check `docker logs incident_ingest_worker` for `[worker] Redis unreachable after 10 retries` or Prisma errors.

### Upload returns 401 in production
- **Cause:** `ADMIN_TOKEN` is set on API but `VITE_ADMIN_TOKEN` is missing in the web `.env`.
- **Fix:** Add `VITE_ADMIN_TOKEN=<token>` to `apps/web/.env` and rebuild.

### Integration tests fail with DB connection error
- **Cause:** Postgres isn't running or migrations haven't been applied.
- **Fix:** `docker compose up -d --wait && pnpm run api:migrate` then re-run tests.

### Worker healthcheck shows `unhealthy` immediately on fresh container
- **Cause:** The `start_period: 15s` gives the worker time to write its first heartbeat before the healthcheck fires. If the container is marked unhealthy before 15s, the start period may not have been applied (older Docker versions).
- **Fix:** Ensure Docker Compose plugin v2.27+ is installed. As a workaround, increase `start_period` to `30s`.
