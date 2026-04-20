# Deployment Readiness — Sprint 1

**Last Updated:** 2026-04-20  
**Status:** 🟡 **IMPLEMENTATION COMPLETE — deployment QA not yet run**

Sprint 1 feature code is complete and all 124 unit + integration tests pass.
The deployment artifacts (Dockerfiles, prod compose, env example) now exist and known blocking issues have been fixed.
What remains is a first build + deploy cycle to confirm the images actually work end-to-end in a container environment.

---

## Code & Feature Implementation

| Item | Status | Notes |
|------|--------|-------|
| Database schema (Source, Document, IngestJob, Incident, Section) | ✅ Done | Prisma + PostgreSQL 16 |
| File upload API (`POST /ingest/upload`) | ✅ Done | Multipart txt/md; stores rawText at upload time |
| BullMQ worker + Redis integration | ✅ Done | Graceful shutdown, retryStrategy, PermanentError |
| NLP parsing package (`@pkg/nlp`) | ✅ Done | parseSections + summarize; 40/40 tests |
| Job status endpoint (`GET /jobs/:jobId`) | ✅ Done | Rate-limited; 404/400 on bad IDs |
| Web upload page | ✅ Done | Drag-and-drop; job polling; incident deep-link on complete |
| Web incident list + detail pages | ✅ Done | React Router + TanStack Query |
| Manual ingest endpoint | ✅ Done | `POST /ingest/manual` |
| Worker liveness heartbeat | ✅ Done | Writes `/tmp/worker-heartbeat.json` every 10s |
| Redis zombie prevention | ✅ Done | `retryStrategy` → `shutdown()` after 10 failures |
| `VITE_ADMIN_TOKEN` support in frontend | ✅ Done | Bearer token sent when env var set |
| Smoke test script | ✅ Done | `scripts/smoke-test.sh` |

---

## Deployment Artifacts

| Artifact | Status | Notes |
|----------|--------|-------|
| `apps/api/Dockerfile` | ✅ Done | node:20-alpine + **openssl** + prisma generate; runs `migrate deploy` on start |
| `apps/worker/Dockerfile` | ✅ Done | node:20-alpine + **openssl** + prisma generate |
| `docker-compose.yaml` (dev) | ✅ Done | db + redis + worker; BusyBox-compatible healthcheck |
| `docker-compose.prod.yml` | ✅ Done | All services; no host port on db/redis; AOF-enabled Redis; BusyBox-compatible healthcheck |
| `.env.prod.example` | ✅ Done | All required vars documented with comments |

---

## Known Issues Fixed (2026-04-20)

| Issue | Fix |
|-------|-----|
| API + worker Alpine images missing `openssl` — Prisma query engine fails at runtime | Added `RUN apk add --no-cache openssl` to both Dockerfiles |
| `docker-compose.prod.yml` worker healthcheck used `find -newermt` — not supported by BusyBox Alpine `find` | Replaced with `stat -c %Y` + arithmetic comparison, which works on BusyBox |
| `docker-compose.yaml` (dev) had the same BusyBox-incompatible healthcheck | Fixed to match prod |
| `.env.prod.example` was missing even though prod compose references it with `:?` required vars | Created with all required and optional vars documented |

---

## Remaining Before Deployment QA Can Begin

These are not code changes — they require a running container environment.

- [ ] `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build --wait` runs clean
- [ ] API container healthcheck reaches **healthy** (`GET /health` returns 200)
- [ ] Worker container healthcheck reaches **healthy** (heartbeat file age < 30s)
- [ ] `prisma migrate deploy` completes inside the API container on first boot
- [ ] Upload a file through the prod compose stack end-to-end (upload → worker → incident)
- [ ] Confirm `ADMIN_TOKEN` auth is enforced (`curl` without header returns 401)
- [ ] Confirm `CORS_ORIGIN` rejects requests from wrong origins

---

## Environment Variables Reference

### Required (no defaults — compose will refuse to start)

| Variable | Service | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | db, api, worker | PostgreSQL username |
| `POSTGRES_PASSWORD` | db, api, worker | PostgreSQL password |
| `REDIS_PASSWORD` | redis, api, worker | Redis requirepass value |
| `ADMIN_TOKEN` | api | Bearer token for upload + source admin routes |

### Optional (have defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `incident_ingest` | Database name |
| `API_PORT` | `3001` | Host port the API is exposed on |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin — **must be set to your real domain in prod** |
| `WORKER_CONCURRENCY` | `2` | Concurrent BullMQ jobs |

### Web (build-time only — not read by compose)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | API base URL baked into the SPA at build time |
| `VITE_ADMIN_TOKEN` | Optional Bearer token sent on file upload |

---

## Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Redis persistence lost on restart | Medium | AOF enabled in prod compose (`--appendonly yes`) |
| Large file uploads cause OOM | Medium | multer size limit set; unsupported MIME types rejected with 400 |
| Worker zombie (connected but not processing) | Medium | retryStrategy exits after 10 Redis failures; Docker healthcheck restarts container |
| Job status polling thundering herd | Medium | Rate-limited by IP on `GET /jobs/:jobId` |
| Database migration conflicts in multi-pod setup | Low | Single worker instance; `prisma migrate deploy` is safe for concurrent runs |
| CORS misconfigured after domain change | Low | Set `CORS_ORIGIN` explicitly in `.env.prod` |

---

## Post-Deployment Monitoring Targets

| Metric | Target |
|--------|--------|
| API GET response time | < 100ms |
| API POST /ingest/upload | < 500ms |
| Worker parse job time | < 30s per file |
| Queue depth alert threshold | > 100 jobs pending |
| Error rate | < 0.5% |

**Go / No-Go:** 🟡 **PENDING** — artifacts ready, deployment QA run not yet completed.
