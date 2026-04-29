# Incident Atlas Pro — Runbook (Sprint 2)

> **Last updated:** 2026-04-29  
> **Status:** ✅ Sprint 2 complete and verified — 137 tests passing, all Docker healthchecks green

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
pnpm --filter @app/worker test        # 53 worker unit tests (health, processor, resolve_text, shutdown, embeddings)
pnpm --filter @app/api test:unit      # 2 API health tests
```
**Expected:** all green.

### Step 2 — Integration tests (requires running Postgres)
```bash
docker compose up -d --wait
pnpm --filter @app/api test:integration
```
**Expected:** migration smoke + upload/job/incident CRUD + search + similar incident tests pass (82 tests total).

### Step 3 — Manual e2e upload & search smoke
```bash
# Terminals A and B
pnpm --filter @app/api dev
pnpm --filter @app/worker dev

# Run the provided smoke-test script covering upload, jobs, search, and similarity
bash scripts/smoke-test.sh
```

### Step 4 — Worker healthcheck (Docker only)
```bash
docker compose up -d --wait
# After ~15s start_period the healthcheck kicks in.
docker inspect --format='{{.State.Health.Status}}' incident_ingest_worker
# → "healthy"
```

---

## Deployment Checklist (Sprint 2) — Verified 2026-04-29

- [x] `docker compose up -d --wait` shows db + redis + worker all **healthy**
- [x] `pnpm run api:migrate` runs cleanly from a fresh schema and includes pgvector setup
- [x] Unit tests pass — 40 NLP + 53 worker + 2 API = 95 unit tests green
- [x] Integration tests pass — 82/82 API tests green
- [x] Manual upload → job → incident → search → similar e2e smoke passes (`scripts/smoke-test.sh`)
- [x] `ADMIN_TOKEN` + `VITE_ADMIN_TOKEN` documented in `.env.example` files
- [x] Rate limits active on `/jobs/:jobId` (express-rate-limit v8, req.ip keygen)
- [x] Worker heartbeat healthcheck confirmed healthy in Docker
- [x] Search capabilities returning correctly scored `results` and `similar` payloads with matched evidence


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
