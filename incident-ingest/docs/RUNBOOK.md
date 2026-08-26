# Incident Atlas Pro - Runbook (Sprint 5)

> **Last updated:** 2026-05-18
> **Status:** Sprint 4 complete, Sprint 5 in progress. Day 1 MVP gates shipped (Redis AOF, PDF reject, file dedup, parallel embed+graph, ADMIN_TOKEN guard, DB pool docs).

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

### 1. Start shared infrastructure (Postgres + Redis + MinIO)
```bash
# From incident-ingest/
docker compose up -d --wait db redis minio
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

### Full local dev stack (API + Worker + Web)
```bash
pnpm run dev          # starts all workspaces with node --watch
```

Do not combine the command above with `docker compose up -d` for the whole
compose file. `docker-compose.yaml` already defines `api` and `worker`, so
starting both modes at once causes the local API to collide on port `3001`.

### Individual components
```bash
# API server (port 3001)
pnpm --filter @app/api dev

# Background worker
pnpm --filter @app/worker dev

# Web UI (port 5173)
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

### Step 1 - Unit tests (no DB/Redis required)
```bash
pnpm --filter @pkg/nlp test
pnpm --filter @app/worker test
pnpm --filter @app/api test:unit      # 2 API health tests
```
**Expected:** all green.

### Step 2 - Integration tests (requires running Postgres)
```bash
docker compose up -d --wait
pnpm --filter @app/api test:integration
```
**Expected:** migration smoke + upload/job/incident CRUD + search + similar incident + graph API + eval/QA API tests pass.

### Step 3 - Release e2e sprint smoke
```bash
# Terminals A and B
pnpm --filter @app/api dev
pnpm --filter @app/worker dev

# Verifies upload/jobs/search/similar/graph/eval/QA
bash scripts/smoke-test.sh
```

### Step 4 - Worker healthcheck (Docker only)
```bash
docker compose up -d --wait
# After ~15s start_period the healthcheck kicks in.
docker inspect --format='{{.State.Health.Status}}' incident_ingest_worker
# → "healthy"
```

---

## Deployment Checklist (Sprint 4) - Verified 2026-05-13

- [x] `docker compose up -d --wait` shows db + redis + worker all **healthy**
- [x] `pnpm run api:migrate` runs cleanly from a fresh schema and includes pgvector plus graph/eval schema setup
- [x] Sprint 4 QA evidence is green: 146 API integration tests, 66 worker tests, and 83 NLP tests
- [x] Release smoke passes: ingest -> extraction -> eval -> citations-first Q&A verified
- [x] `ADMIN_TOKEN` + `QA_TOKEN` + `VITE_ADMIN_TOKEN` documented in `.env.example` files
- [x] Route-specific rate limits active
- [x] Worker heartbeat healthcheck confirmed healthy in Docker
- [x] Evaluation reporting and Q&A citation refusal logic confirmed functioning


---

## Worker Liveness — How it works

The worker writes `/tmp/worker-heartbeat.json` every **10 seconds** while connected.  
The Docker healthcheck (`docker-compose.yaml`) tests that the file is less than 30 seconds old.  
If Redis is lost and the retry strategy exhausts 10 attempts, the worker calls `shutdown("redis-exhausted")` and exits—Docker restarts it automatically (`restart: unless-stopped`).

---

## Production Environment Variables

### Required

| Variable | Service | Description |
|----------|---------|-------------|
| `ADMIN_TOKEN` | api | Bearer token for upload + source admin routes. **API refuses to start in production if unset.** |
| `DATABASE_URL` | api, worker | PostgreSQL connection string |
| `REDIS_URL` | api, worker | Redis connection URL |

### DB Connection Pool (set in DATABASE_URL query string)

```bash
# apps/api — higher concurrency, more connections
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/incident_ingest?connection_limit=20&pool_timeout=10"

# apps/worker — lower concurrency, fewer connections needed
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/incident_ingest?connection_limit=10&pool_timeout=10"
```

Default Prisma pool: 5 connections. Under load (20+ concurrent uploads) this causes connection timeouts. Set `connection_limit` explicitly.

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API listen port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin — set to your real domain in prod |
| `WORKER_CONCURRENCY` | `2` | Concurrent BullMQ jobs |
| `EMBEDDING_PROVIDER` | `local` | `local` (deterministic hash) \| `bge` (bge-small in-process) \| `ollama` (e.g. bge-m3) |
| `EMBEDDING_MODEL` | `BAAI/bge-small-en-v1.5` | Embedding model for `bge`/`ollama` providers |
| `EMBEDDING_DIMENSIONS` | `384` | Native dims of the model (1024 for bge-m3); storage is always vector(1536), zero-padded |
| `QA_PROVIDER` | `local` | `local` extractive \| `ollama` Qwen3-4B-Instruct generation |
| `QA_MODEL` | `qwen3:4b` | Ollama model for Q&A generation |
| `GRAPH_EXTRACTOR` | `rules` | `rules` deterministic \| `ollama` strict-JSON Qwen extraction |
| `GRAPH_MODEL` | `qwen3:4b` | Ollama model for graph extraction |
| `RERANKER_PROVIDER` | `none` | `none` \| `local` token-overlap \| `bge` (bge-reranker-base via `RERANKER_URL`) |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server (open-source models — no Anthropic/OpenAI anywhere) |
| `RETRIEVAL_BACKEND` | `pgvector` | `pgvector` (stable) \| `turboquant` (EXPERIMENTAL) \| `hybrid` |
| `TURBOQUANT_ENABLED` | `false` | Write TurboQuant codes at index time (see docs/TURBOQUANT_RAG_PLAN.md) |
| `LOG_LEVEL` | `info` | Logging verbosity: `trace`, `debug`, `info`, `warn`, `error` |

---

## Deployment QA Checklist

Run before any demo or production deployment. Steps require a running container environment — not just code review.

### Pre-flight (prod compose)
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build --wait
```

- [ ] All containers reach **healthy**: `docker ps --format "table {{.Names}}\t{{.Status}}"`
- [ ] API healthcheck: `curl -f http://localhost:3001/health` returns 200
- [ ] Worker heartbeat healthcheck: `docker inspect --format='{{.State.Health.Status}}' incident_ingest_worker` → `healthy`
- [ ] `prisma migrate deploy` completed inside API container on first boot (check `docker logs incident_ingest_api | grep migrate`)
- [ ] Upload file end-to-end: upload → worker picks up → incident created
- [ ] `ADMIN_TOKEN` enforced: `curl http://localhost:3001/ingest/upload` without header returns 401
- [ ] Duplicate upload rejected: same file twice → second returns 409 with `documentId`
- [ ] Unsupported MIME rejected at upload: PDF returns 400 immediately (not 202→poll→failed)
- [ ] CORS: request from wrong origin returns 403

### Post-deployment monitoring targets

| Metric | Target |
|--------|--------|
| `GET` response time | < 100ms |
| `POST /ingest/upload` (handoff) | < 500ms |
| Worker parse job time | < 30s per file |
| Queue depth alert threshold | > 100 jobs pending |
| Error rate | < 0.5% |

### Deployment artifacts

| Artifact | Notes |
|----------|-------|
| `apps/api/Dockerfile` | node:20-alpine + openssl + prisma generate; runs `migrate deploy` on start |
| `apps/worker/Dockerfile` | node:20-alpine + openssl + prisma generate |
| `docker-compose.yaml` (dev) | db + redis + worker; BusyBox-compatible healthcheck |
| `docker-compose.prod.yml` | All services; no host port on db/redis; AOF-enabled Redis |
| `.env.prod.example` | All required vars documented with comments |

---

## Open-Source RAG Operations (Sprint 5)

Full stack reference: `docs/OPEN_SOURCE_RAG_STACK.md`. TurboQuant details:
`docs/TURBOQUANT_RAG_PLAN.md`. No Anthropic / no OpenAI anywhere.

### Switch embedding provider

```bash
# 1. Set env (api + worker): EMBEDDING_PROVIDER=bge   (or ollama + bge-m3)
# 2. Rebuild the chunk index with the new model:
pnpm reindex:chunks
# 3. Verify: chunk rows carry embedding_provider/embedding_model columns.
```

Never mix providers in one index — query-time and index-time embeddings must
come from the same model.

### Enable Ollama generation (Q&A + graph)

```bash
ollama pull qwen3:4b
# env: QA_PROVIDER=ollama  GRAPH_EXTRACTOR=ollama  OLLAMA_URL=http://localhost:11434
```

If Ollama is down or returns uncited output, Q&A degrades to the local
extractive answerer (still cited) and graph extraction falls back to rules —
ingest never blocks on a model server.

### TurboQuant (EXPERIMENTAL)

```bash
# Write compressed codes at index time:
#   TURBOQUANT_ENABLED=true  (then) pnpm reindex:chunks
# Query through them:
#   RETRIEVAL_BACKEND=turboquant   # or hybrid for side-by-side fusion
```

Keep `RETRIEVAL_BACKEND=pgvector` in production until the promotion criteria
in `docs/TURBOQUANT_RAG_PLAN.md` pass. Changing `TURBOQUANT_BITS/ROTATION/SEED`
requires a chunk reindex; mismatched rows are skipped at query time.

### Benchmarks

```bash
pnpm bench                              # fixture mode — offline, no DB needed
node scripts/benchmark.mjs --mode live  # end-to-end vs running API (DB required)
```

Reports: recall@5/10, MRR, nDCG@10 per backend, search/QA latency p50/p95,
TurboQuant recall delta + memory reduction, citation precision, refusal
accuracy. Output → `artifacts/bench/*.json` (gitignored).

---

## Risk Register

All known risks across architecture, ML/retrieval, infrastructure, NLP pipeline, and quality. Ordered by retrieval impact first, then operational.

---

### Category A — Retrieval Correctness (blocks MVP accuracy)

---

#### A-1 · CRITICAL · Fake embeddings — entire retrieval pipeline returns wrong results
**Source:** ML-1 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-001 in Sprint 5  
**Problem:** `createEmbedding()` in `packages/nlp/src/index.js` is SHA-256 hash-based random projection, not semantic. With the default `EMBEDDING_PROVIDER=local`, cosine similarity ≈ token overlap, not meaning. "database connection pool exhausted" and "DB conn saturation" score near zero.  
**Fix (shipped, Sprint 5):** Open-source provider chain is wired — set `EMBEDDING_PROVIDER=bge` (BAAI/bge-small-en-v1.5 in-process, free) or `EMBEDDING_PROVIDER=ollama` with `EMBEDDING_MODEL=bge-m3`. The hash embedding remains only as the offline/test fallback. After switching providers run `pnpm reindex:chunks` to rebuild the chunk index (HNSW indexes ship in migration `20260610000000_chunks_retrieval`). No paid APIs — cost is $0.  
**Residual risk:** the default remains `local` so out-of-the-box semantic quality is still poor until an operator opts into `bge`/`ollama`.  
**Ticket:** W5-001

---

#### A-2 · HIGH · Embedding backfill not run after provider switch
**Source:** ML-1 / Data-7  
**Status:** Open — part of W5-001  
**Problem:** Wiring real embeddings (A-1) does not retroactively fix existing incidents. All incidents ingested before the switch still have hash vectors. Search returns a mix of real and garbage similarity scores.  
**Fix (shipped, Sprint 5):** `pnpm reindex:chunks` rebuilds all retrieval chunks with the configured provider (keyset-paginated, resumable, idempotent). Chunk rows record `embedding_provider`/`embedding_model`/`embedding_dim`, so mixed-provider indexes are detectable. Must be run as a one-time op on every environment after a provider switch.

---

#### A-3 · HIGH · One symptom per section cap — graph misses co-occurring failures
**Source:** ML-7 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-008 in Sprint 5  
**Problem:** `break` in SYMPTOM_PATTERNS loop in `graphExtract.js` captures only first match per section. "We saw elevated error rate, OOM kills, and cascading timeouts" → one node. Downstream graph queries and Q&A miss the other two failure relationships.  
**Fix:** Remove `break` from SYMPTOM_PATTERNS loop. Let all matches through; confidence filter in `validateNode` drops noise (requires A-5 first).  
**Ticket:** W5-008

---

#### A-4 · HIGH · LLM confidence threshold is a no-op — noise nodes enter graph
**Source:** ML-2 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-002 in Sprint 5  
**Problem:** Graph extraction prompt says "minimum confidence: 0.75" but response JSON schema has no `confidence` field. LLM ignores it or adds prose that gets stripped. All extracted nodes pass through regardless of quality. Graph fills with garbage → graph queries return noise → Q&A cites wrong evidence.  
**Fix:** Add `confidence` to extraction JSON schema. Filter in `validateNode`:
```js
if ((raw.confidence ?? 1.0) < 0.75) return null;
```
**Ticket:** W5-002

---

#### A-5 · HIGH · NOISE_TERMS blocks legitimate short service names
**Source:** NLP-2 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-008 in Sprint 5  
**Problem:** `NOISE_TERMS = new Set(["service", "database", "api", "server", ...])` applied to all names including multi-word. Service literally named "api" or "database" (common in microservice stacks) is silently dropped. "api-gateway" passes (hyphenated); "api" fails (exact match).  
**Fix:** Apply NOISE_TERMS only to single-word names:
```js
const isSingleWord = !name.includes(" ") && !name.includes("-");
if (isSingleWord && NOISE_TERMS.has(name)) return null;
```
**Ticket:** W5-008

---

#### A-6 · HIGH · Service regex extracts environment terms as service nodes
**Source:** NLP-3 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-008 in Sprint 5  
**Problem:** `extractServiceFromMeta` uses `\b([A-Za-z][A-Za-z0-9][-a-zA-Z0-9]{2,30})\b`. "Production Database Outage" → matches "Production". "AWS RDS Connection Failure" → matches "AWS". Neither is in NOISE_TERMS. Graph fills with environment/region names instead of actual services.  
**Fix:** Require hyphen or camelCase boundary:
```js
const match = src.match(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+|[A-Z][a-z]+[A-Z][a-zA-Z0-9]+)\b/);
// matches: "payment-api", "PaymentAPI" — rejects: "Production", "AWS", "Database"
```
**Ticket:** W5-008

---

#### A-7 · HIGH · Section parser fails on real-world unstructured incident reports
**Source:** NLP-1 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — Week 2 (post Sprint 5)  
**Problem:** Two-pass parser looks for exact labels ("Impact:", "Root Cause:", etc.) then falls back to position-based section type assignment (para 1 = impact, para 2 = timeline, ...). Real-world inputs — Slack exports, GitHub issue comments, blog postmortems, PagerDuty exports — rarely use these labels. Position fallback assigns wrong section types → wrong graph nodes → wrong embeddings → wrong retrieval.  
**Fix:** LLM-based section classification (Qwen3-4B via Ollama, strict JSON) with rule-based fallback:
```js
export async function parseSections(rawText) {
  if (getRagConfig().graph.extractor !== "ollama") return ruleBasedParseSections(rawText);
  // Qwen JSON classify → array of {type, text} → fallback to rules on parse error
}
```
Cost: $0 (self-hosted). Week 2 work (NLP-1).

---

#### A-8 · MEDIUM · No token-aware section chunking — long sections lose tail content
**Source:** ML-8 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — Week 2  
**Problem:** `parseSections` emits full content between headings as one Section. 5,000-word root-cause analysis = one Section row. Embedding models truncate long inputs (bge-small at 512 tokens) — long sections lose tail content, and in postmortems the actual fix is usually at the end.  
**Fix (shipped, Sprint 5):** the `chunks` table stores one `section` chunk plus `paragraph` chunks (~700 chars, 80-char overlap) per long section, each anchored to `section_id` for exact citations. Retrieval/QA use chunks first and fall back to section search.

---

#### A-9 · MEDIUM · Entity canonicalization missing — graph nodes multiply at scale
**Source:** ML-6 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — Week 2 (requires A-1 real embeddings first)  
**Problem:** "payment-api", "payments-api", "PaymentService", "Payment API" → 4 separate `graph_nodes` rows. `normalizeNodeName` only lowercases. After 500 incidents the graph has hundreds of near-duplicate nodes. Pattern queries return fragmented results.  
**Fix:** Before INSERT into graph_nodes, cosine-search existing nodes of same type. If nearest neighbor distance < 0.12, merge into existing canonical node. Requires `embedding vector(1536)` on `graph_nodes` (new migration).

---

### Category B — Data Integrity

---

#### B-1 · CRITICAL · Duplicate file ingestion creates N incidents per file
**Source:** SDE-3  
**Status:** DONE — Sprint 5 Day 1  
**Fix shipped:** `Document.hash @unique` Prisma constraint + partial index (null-safe) + 409 response with `documentId` + `incidentId` before `prisma.document.create()`. Re-uploading same file returns 409 immediately; body links to existing incident.

---

#### B-2 · CRITICAL · PDF accepted at upload, permanently fails in worker
**Source:** SDE-2  
**Status:** DONE — Sprint 5 Day 1  
**Fix shipped:** `fileFilter` MIME allowlist narrowed to `["text/plain", "text/markdown"]`. PDF returns 400 at upload boundary, not 202 → poll → failed.

---

#### B-3 · HIGH · `retrieval.js` and `graph.js` duplicated across API and worker
**Source:** SDE-5 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — Week 2  
**Problem:** `apps/api/src/lib/retrieval.js` and `apps/worker/src/retrieval.js` are separate copies. Same for `graph.js`. Changes must land in both. Caused signature drift in W3-002. Will cause bugs when embedding provider is switched (A-1).  
**Fix:** Create `packages/db/` workspace. Move both files there. Both apps import from `@pkg/db`.

---

#### B-4 · MEDIUM · `IngestJob.stage` is untyped string — typos create unknown stages
**Source:** SDE-7 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — Week 2  
**Problem:** `stage String @default("queued")` is freeform. Stage values ("queued", "parsing", "indexing") are magic strings scattered as literals. No compile-time validation.  
**Fix:** Add `JobStage` enum to Prisma schema. One migration.

---

#### B-5 · LOW · `ingestRunner.js` is orphaned dead code
**Source:** SDE-8 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — audit before Sprint 5 release  
**Problem:** `apps/api/src/lib/ingestRunner.js` not imported by any route or module. Adds surface area, not tested, may contain stale logic.  
**Fix:** Audit. If unused, delete.

---

### Category C — Infrastructure & Operational

---

#### C-1 · CRITICAL · Local disk storage — broken in any multi-container deploy
**Source:** DO-1 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-003 in Sprint 5  
**Problem:** `multer({ dest: "uploads/" })` writes to API container's local filesystem. Worker reads `doc.rawPath`. API and worker are separate Docker services — `rawPath` does not exist on worker container. Fails silently (falls back to `rawText` only). Large files that relied on disk path are unprocessable by worker.  
**Fix:** MinIO (self-hosted, S3-compatible, zero cost). Add to compose. `storage.js` wraps `@aws-sdk/client-s3` with `forcePathStyle: true`. Upload writes to MinIO; store S3 key as `rawPath`. Worker reads via `readFromStorage(key)`. After: drop `Document.rawText` column (migration).  
**Ticket:** W5-003

---

#### C-2 · CRITICAL · No API service in docker-compose — no standardized API container
**Source:** DO-2 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-004 in Sprint 5  
**Problem:** `docker-compose.yaml` has `db`, `redis`, `worker` — but no `api` service. `docker compose up` starts data layer + worker but not API. No API Dockerfile. API has no container healthcheck. Production has no reproducible API deployment.  
**Fix:** `apps/api/Dockerfile` (node:22-alpine, openssl, prisma generate). Add `api` service to compose with `depends_on: db + redis`, healthcheck on `GET /ready`.  
**Ticket:** W5-004

---

#### C-3 · HIGH · Redis queue lost on restart — job batch lost on any reboot
**Source:** DO-3  
**Status:** DONE — Sprint 5 Day 1  
**Fix shipped:** `command: redis-server --appendonly yes --appendfsync everysec` in both dev and prod compose. Max 1 second data loss on hard crash. Jobs survive Redis restarts.

---

#### C-4 · HIGH · No resource limits — one bad LLM call can OOM-kill entire stack
**Source:** DO-4 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-004 in Sprint 5  
**Problem:** All containers run with no CPU/memory limits. One slow Postgres query or LLM backfill batch can consume all host memory, OOM-kill Redis, take down entire stack.  
**Fix:** Add `deploy.resources.limits` to all services in compose:
```yaml
db:     { cpus: "2.0", memory: "2G" }
redis:  { cpus: "0.5", memory: "256M" }
worker: { cpus: "2.0", memory: "1G" }
api:    { cpus: "1.0", memory: "512M" }
minio:  { cpus: "0.5", memory: "512M" }
```
**Ticket:** W5-004

---

#### C-5 · HIGH · No structured logging — impossible to debug production issues
**Source:** DO-5 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-005 in Sprint 5  
**Problem:** `console.log/warn/error` throughout API and worker. No log levels, no request IDs, no structured JSON. Multiple workers produce interleaved string output with no correlation. Cannot grep for specific request or job in production.  
**Fix:** Pino (`pino` + `pino-http`). Module-level logger in `apps/api/src/lib/logger.js`. Replace all `console.log` in api and worker. `LOG_LEVEL` env var respected.  
**Ticket:** W5-005

---

#### C-6 · HIGH · No CI pipeline — regressions ship without automated feedback
**Source:** DO-7 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-006 in Sprint 5  
**Problem:** No `.github/workflows/`. All tests run manually. No guarantee merged code passes tests. OSS contributors get zero PR feedback.  
**Fix:** GitHub Actions (free on public repos). Services: `pgvector/pgvector:pg16` + `redis:7-alpine`. Steps: install → migrate → unit tests → integration tests. Skip 2 pre-existing Redis timeout failures with `test.skip` + tracking comment.  
**Ticket:** W5-006

---

#### C-7 · MEDIUM · No liveness vs readiness probe distinction
**Source:** DO-6 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-004 in Sprint 5  
**Problem:** `GET /health` returns `{ ok: true }` (liveness only). No readiness check. Load balancer routes traffic to API before DB migration finishes or Prisma pool initializes.  
**Fix:** Add `GET /ready` that runs `SELECT 1` against Prisma. Returns 503 if DB unreachable. Docker compose healthcheck points to `/ready` with `start_period: 20s`.  
**Ticket:** W5-004

---

#### C-8 · MEDIUM · Database connection pool exhaustion under load
**Source:** Data-8 / SDE-6  
**Status:** Documented only — not enforced in defaults  
**Problem:** Default Prisma pool = 5 connections. At 20+ concurrent uploads causes connection timeouts. Documentation fix only — if `.env` copied from example without setting pool, production silently runs with 5 connections.  
**Better fix:** Set `connection_limit=20` in `.env.example` for API and `connection_limit=10` for worker so default is already right, not a runbook note.
```bash
# apps/api/.env.example
DATABASE_URL="postgresql://postgres:postgres@db:5432/incident_ingest?connection_limit=20&pool_timeout=10"
# apps/worker/.env.example
DATABASE_URL="postgresql://postgres:postgres@db:5432/incident_ingest?connection_limit=10&pool_timeout=10"
```

---

#### C-9 · MEDIUM · Worker zombie window — up to 60s unprocessed during Redis reconnect
**Source:** Operational  
**Status:** Accepted for MVP  
**Problem:** retryStrategy exhausts 10 Redis retries before calling shutdown. Depending on retry delays, zombie window can be 30–60s. Jobs queue up, not processing. Docker restart resolves but adds another ~15s start_period. Total potential gap: ~75s.  
**Mitigation:** retryStrategy + Docker healthcheck + `restart: unless-stopped` in place. Acceptable for MVP. Flag for reduction if SLA requires faster recovery.

---

#### C-10 · LOW · Job polling thundering herd (untested rate limit)
**Source:** QE-3  
**Status:** Rate limit exists; load test does not  
**Problem:** `GET /jobs/:jobId` rate-limited by IP (configured). Limit never load-tested. No verification it fires correctly. At scale, clients polling every 2s each = potential DB pressure.  
**Fix:** k6 load test (Week 2). 20 VUs × 30s → verify 200 and 429 responses, no 500s.

---

#### C-11 · LOW · CORS misconfigured after domain change
**Source:** Operational  
**Status:** Documented  
**Mitigation:** Set `CORS_ORIGIN` explicitly in `.env.prod`. Not a retrieval issue.

---

### Category D — LLM Quality

---

#### D-1 · RESOLVED (Sprint 5) · Anthropic dependency removed from the LLM path
**Source:** ML-3 (MVP_PRODUCTION_PLAN.md)  
**Status:** Resolved — W5-002  
**Was:** `graphExtract.js` dynamically imported `@anthropic-ai/sdk` and created a new client per extraction call.  
**Now:** the LLM path is plain HTTP to a self-hosted Ollama server (`GRAPH_EXTRACTOR=ollama`, `GRAPH_MODEL=qwen3:4b`, strict-JSON mode) via global `fetch` — no SDK, no per-call client construction, no API key. Deterministic rules remain the default and the fallback.  
**Ticket:** W5-002

---

#### D-2 · RESOLVED (Sprint 5) · Token billing eliminated — self-hosted generation only
**Source:** ML-4 (MVP_PRODUCTION_PLAN.md)  
**Status:** Resolved — W5-002  
**Was:** every extraction call re-sent ~600 static prompt tokens to a paid API with no prompt caching.  
**Now:** generation runs on self-hosted open models (Qwen3-4B via Ollama). There is no per-token billing; the static prompt cost is local compute only. If remote serving is ever reintroduced, revisit prompt caching then.  
**Ticket:** W5-002

---

#### D-3 · HIGH · `summarize()` is first-paragraph truncation, not semantic summary
**Source:** ML-5 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — Week 2  
**Problem:** `summarize()` takes `paragraphs[0]` and truncates at 280 chars. Incident reports often start with metadata headers ("Date: 2024-01-15 | Severity: P1 | On-call: team-infra"). That header becomes `summaryText` → feeds `summary_embedding` → all similar-incident retrieval based on metadata, not content.  
**Fix:** LLM summarization via Qwen3-4B (Ollama) with extractive first-paragraph fallback when no model server is configured. Cost: $0 (self-hosted).

---

### Category E — Quality & Testing

---

#### E-1 · HIGH · 2 permanently-failing tests — regressions get masked
**Source:** QE-1 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-006 in Sprint 5  
**Problem:** `ingest_upload_jobs.test.js` has 2 Redis timeout failures present since W3-001-QA. Every QA cycle notes "pre-existing failures — unrelated." CI (when added) always shows failures. Engineers become desensitized; real regressions get missed.  
**Fix:** `test.skip("...[tracked: GH-#42]")` or fix underlying Redis setup in test. Zero permanently-failing tests in CI.  
**Ticket:** W5-006

---

#### E-2 · HIGH · No API contract tests — frontend type drift goes undetected
**Source:** QE-2 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — W5-007 in Sprint 5  
**Problem:** `apps/web/src/lib/api.ts` TypeScript interfaces manually mirror API contract. API changed `results` → `data` twice in Sprint 2. Frontend broke each time, caught only in manual QA. No automated guard.  
**Fix:** Supertest snapshot tests in `apps/api/src/tests/contracts.test.js` for all 6 endpoints. Vitest `toMatchObject`. Break + restore test verifies detection works.  
**Ticket:** W5-007

---

#### E-3 · MEDIUM · No eval regression gate in CI
**Source:** QE-4 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — Week 2  
**Problem:** `POST /eval/run` computes Recall@K, MRR, NDCG and compares against baseline. CI never runs eval. A retrieval regression (broken embedding path) ships without any CI failure.  
**Fix:** Add eval step to CI: seed fixture incidents, run eval, fail CI if `recallAt5 < 0.8`. Requires fixture seed script (10 incidents + matching queries).

---

#### E-4 · LOW · Rate limits never load-tested
**Source:** QE-3 (MVP_PRODUCTION_PLAN.md)  
**Status:** Open — Week 2  
**Problem:** Rate limits configured (60 req/60s public, 10 req/60s admin) but never tested. Could silently break. No test of Postgres pool behavior at load.  
**Fix:** k6 load test. 20 VUs × 30s on `/search`. Verify 200 + 429 responses, no 500s.

---

## Troubleshooting

### Worker zombie (connected but not processing)
- **Symptom:** `docker inspect incident_ingest_worker` shows `unhealthy`.
- **Action:** Container will restart automatically. Check `docker logs incident_ingest_worker` for `[worker] Redis unreachable after 10 retries` or Prisma errors.

### Upload returns 401 in production
- **Cause:** `ADMIN_TOKEN` is set on API but `VITE_ADMIN_TOKEN` is missing in the web `.env`.
- **Fix:** Add `VITE_ADMIN_TOKEN=<token>` to `apps/web/.env` and rebuild.

### Upload returns 409 Conflict
- **Cause:** File with identical SHA-256 hash was already ingested.
- **Response body:** `{ "error": "File already ingested", "documentId": "...", "incidentId": "..." }` — link directly to existing incident.

### Integration tests fail with DB connection error
- **Cause:** Postgres isn't running or migrations haven't been applied.
- **Fix:** `docker compose up -d --wait && pnpm run api:migrate` then re-run tests.

### Worker healthcheck shows `unhealthy` immediately on fresh container
- **Cause:** The `start_period: 15s` gives the worker time to write its first heartbeat before the healthcheck fires. If the container is marked unhealthy before 15s, the start period may not have been applied (older Docker versions).
- **Fix:** Ensure Docker Compose plugin v2.27+ is installed. As a workaround, increase `start_period` to `30s`.
