# Sprint 1 — Pending Items for Production Deployment

**Status:** 🔴 NOT DEPLOYMENT READY  
**Completed:** All code implementation  
**Remaining:** QA, Docker, runbook, smoke tests  
**Estimated time to production:** 15–25 hours (2–3 days full-time)

---

## Critical Path — Must Complete Before Deployment

### ✋ STOP: Do NOT Deploy Without Completing All These

| # | Item | Owner | Effort | Blocker | Notes |
|---|------|-------|--------|---------|-------|
| 1 | **W1-003-QA** File upload security review | qa_security | 1–2 hrs | YES | Check MIME validation, size limits, path traversal |
| 2 | **W1-004-QA** Worker resilience review | qa_security | 1–2 hrs | YES | Redis reconnect, queue drain, error logging |
| 3 | **W1-005-QA** NLP edge cases | qa_security | 1 hr | YES | Empty input, huge text, malformed sections |
| 4 | **W1-006-QA** Job status endpoint | qa_security | 1 hr | YES | 404 on unknown job, response time, rate-limit |
| 5 | **Create Dockerfile.api** | backend_builder | 1 hr | YES | node:20-alpine, migrations, health check |
| 6 | **Create Dockerfile.worker** | backend_builder | 1 hr | YES | node:20-alpine, REDIS_URL, graceful shutdown |
| 7 | **Create docker-compose.prod.yml** | backend_builder | 1 hr | YES | Production settings, volumes, env vars |
| 8 | **Build + test Docker images** | backend_builder | 1 hr | YES | Build locally, verify all services boot |
| 9 | **Wire `/upload` form to async** | frontend_builder | 1–2 hrs | YES | Update `Upload.tsx`, add job polling |
| 10 | **Write runbook** | release_integrator | 2–3 hrs | YES | Startup, health checks, shutdown, troubleshooting |
| 11 | **End-to-end smoke test** | qa_security | 1–2 hrs | YES | Upload → parse → view flow passes |

**Parallel paths:** (1,2,3,4) can run in parallel with (5,6,7,8) and (10)

---

## Detailed Breakdown

### 📋 QA Reviews (4 tickets, ~4–6 hours total)

#### W1-003-QA: File Upload API Security
**Ticket:** Test `POST /ingest/upload` multipart handling  
**Acceptance criteria:**
- ✅ Rejects files larger than 50MB
- ✅ Rejects invalid MIME types (only PDF/text/markdown allowed)
- ✅ Prevents path traversal in filename (e.g., `../../etc/passwd`)
- ✅ Returns proper error messages (400, not 500)

**Test fixtures needed:**
- Large file (100MB)
- Malicious filename (e.g., `../../../etc/passwd`)
- Invalid MIME (e.g., `.exe`, `.zip`)

---

#### W1-004-QA: Worker Resilience
**Ticket:** Test BullMQ worker error handling + graceful shutdown  
**Acceptance criteria:**
- ✅ Worker reconnects to Redis after connection drop
- ✅ Jobs don't get lost on worker crash (retryable)
- ✅ Graceful SIGTERM: drains in-flight jobs before exiting
- ✅ Errors logged to stderr (not silent failures)

**Test steps:**
1. Start worker
2. Enqueue 5 jobs
3. Kill Redis container mid-processing → verify worker reconnects
4. Send SIGTERM to worker → verify jobs complete before exit
5. Check logs for error messages

---

#### W1-005-QA: NLP Package Edge Cases
**Ticket:** Test `parseSections()` and `summarize()` robustness  
**Acceptance criteria:**
- ✅ `parseSections('')` returns `[]` (not error)
- ✅ `parseSections(huge_50mb_text)` doesn't OOM
- ✅ `summarize(text, 280)` never exceeds 280 chars
- ✅ Handles sections with no labels gracefully

**Test fixtures:**
- Empty string
- 50MB random text
- Sections with typos in labels (e.g., "IMPACT:" vs "Impact:")

---

#### W1-006-QA: Job Status Endpoint
**Ticket:** Test `GET /jobs/:jobId` performance + correctness  
**Acceptance criteria:**
- ✅ Returns 404 for unknown jobId (not 500)
- ✅ Response time < 50ms (no DB query)
- ✅ Status values are correct: waiting, active, completed, failed
- ✅ Completed jobs include `result` field with incidentId

**Test steps:**
1. Create job, poll `/jobs/:id` at each state
2. Query non-existent jobId → expect 404
3. Measure response time with `curl -w %{time_total}`

---

### 🐳 Docker & Infrastructure (3 files, ~4 hours)

#### Create Dockerfile.api
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy pnpm lock first (for layer caching)
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/ ./packages/

# Install production deps
RUN npm install -g pnpm && pnpm install --prod

# Copy rest of code
COPY . .

# Generate Prisma client
RUN pnpm api:generate

# Run migrations (optional: can use init container instead)
RUN pnpm api:migrate

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "apps/api/src/server.js"]
```

**Acceptance:**
- ✅ Image builds without error
- ✅ Container starts and listens on 3001
- ✅ Health check succeeds after startup
- ✅ Logs go to stdout (not file)

---

#### Create Dockerfile.worker
```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/ ./packages/

RUN npm install -g pnpm && pnpm install --prod

COPY . .

ENV NODE_ENV=production

CMD ["node", "apps/worker/src/worker.js"]
```

**Acceptance:**
- ✅ Image builds
- ✅ Container connects to Redis (via env var)
- ✅ Container gracefully shutdowns on SIGTERM
- ✅ Logs output to stdout

---

#### Create docker-compose.prod.yml
```yaml
version: "3.8"

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD}  # From .env.prod
      POSTGRES_DB: incident_ingest
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 10s
      timeout: 5s
      retries: 3

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  api:
    image: incident-atlas-api:${VERSION:-latest}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/incident_ingest
      REDIS_URL: redis://redis:6379
      PORT: 3001
      CORS_ORIGIN: ${CORS_ORIGIN:-https://example.com}
      NODE_ENV: production
    ports:
      - "3001:3001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  worker:
    image: incident-atlas-worker:${VERSION:-latest}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/incident_ingest
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
    restart: unless-stopped

volumes:
  pgdata:
  redisdata:
```

**Acceptance:**
- ✅ `docker-compose -f docker-compose.prod.yml up -d` boots all services
- ✅ All health checks pass
- ✅ No secrets in code (uses env vars)
- ✅ Volumes persist data across restarts

---

### 📖 Runbook (1 document, ~2–3 hours)

**File:** `incident-ingest/docs/RUNBOOK.md` or `ops/RUNBOOK.md`

**Sections required:**

1. **Startup Procedure**
   - Prerequisites (Docker, env files, secrets)
   - Command to bring up services
   - Verification steps (health checks)
   - Typical startup time

2. **Health Checks**
   - API health: `curl http://api:3001/health`
   - Worker status: (logs should show "Worker started")
   - Database: `docker exec db psql -U postgres -c "SELECT 1"`
   - Redis: `docker exec redis redis-cli ping`

3. **Graceful Shutdown**
   - Send SIGTERM to container (not SIGKILL)
   - Wait for job drain (should complete in < 30s)
   - Verify no orphaned jobs in Redis
   - Stop containers in reverse order (worker, api, redis, db)

4. **Monitoring & Alerts**
   - Where to find logs (stdout → CloudWatch / ELK / etc.)
   - Key metrics to track: queue depth, API latency, error rate
   - Alert thresholds (e.g., queue depth > 100)

5. **Troubleshooting**
   - "API won't start" → check DB connection string
   - "Worker crashes" → check REDIS_URL, look for OOM
   - "Stuck jobs" → inspect Redis with `redis-cli`
   - "Database locked" → retry migrations

6. **Rollback Procedure**
   - If new version breaks, revert to last stable image
   - Database schema: migrations are one-way (ensure backward compat)
   - Cache clear (if needed): flush Redis

---

### 🎨 Frontend: Wire `/upload` Form (1–2 hours)

**File:** `apps/web/src/routes/Upload.tsx`

**Changes needed:**
1. Change form submission endpoint from `/ingest/manual` to `/ingest/upload`
2. Update request to send multipart formData (not JSON)
3. Extract `jobId` from response
4. Poll `GET /jobs/:jobId` every 1 second until completion
5. On completion, redirect to `/incidents/:incidentId`
6. Show loading/progress UI while polling

**Example code:**
```typescript
async function handleSubmit(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  setLoading(true);
  
  // Create FormData from file input
  const formData = new FormData(e.currentTarget);
  
  // Upload
  const uploadRes = await fetch("/ingest/upload", {
    method: "POST",
    body: formData, // multipart
  });
  const { jobId } = await uploadRes.json();
  
  // Poll job status
  const pollInterval = setInterval(async () => {
    const statusRes = await fetch(`/jobs/${jobId}`);
    const { status, result } = await statusRes.json();
    
    if (status === "completed") {
      clearInterval(pollInterval);
      navigate(`/incidents/${result.incidentId}`);
    } else if (status === "failed") {
      setError("Parse failed. Try again.");
      clearInterval(pollInterval);
    }
  }, 1000);
}
```

---

### ✅ Smoke Test Script (1–2 hours)

**File:** `scripts/smoke-test.sh`

```bash
#!/bin/bash
set -e

API_URL=${API_URL:-http://localhost:3001}
WEB_URL=${WEB_URL:-http://localhost:5173}

echo "🧪 Smoke Test: Incident Atlas Pro Sprint 1"
echo "API: $API_URL"
echo "Web: $WEB_URL"
echo ""

# 1. Check API health
echo "1️⃣  Checking API health..."
curl -f "$API_URL/health" || exit 1
echo "✅ API healthy"

# 2. Create test incident via upload
echo ""
echo "2️⃣  Creating test incident..."
RESPONSE=$(curl -s -F "file=@test_incident.md" "$API_URL/ingest/upload")
JOB_ID=$(echo $RESPONSE | jq -r '.jobId')
echo "✅ Job created: $JOB_ID"

# 3. Poll job status until completion
echo ""
echo "3️⃣  Waiting for job to complete..."
TIMEOUT=30
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  STATUS=$(curl -s "$API_URL/jobs/$JOB_ID" | jq -r '.status')
  if [ "$STATUS" == "completed" ]; then
    INCIDENT_ID=$(curl -s "$API_URL/jobs/$JOB_ID" | jq -r '.result.incidentId')
    echo "✅ Job completed: $INCIDENT_ID"
    break
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

# 4. Fetch incident
echo ""
echo "4️⃣  Fetching incident..."
curl -f "$API_URL/incidents/$INCIDENT_ID" | jq . || exit 1
echo "✅ Incident fetched"

# 5. Check web UI
echo ""
echo "5️⃣  Checking web UI..."
curl -f "$WEB_URL/incidents/$INCIDENT_ID" > /dev/null || exit 1
echo "✅ Web UI accessible"

echo ""
echo "✅ All smoke tests passed!"
```

**Acceptance:**
- ✅ Script completes without error
- ✅ File is created and parsed
- ✅ Job status tracked successfully
- ✅ Incident appears in API and web UI

---

## Quick Reference: Priority Order

### Do These First (Parallel)
1. **Send QA tickets** to qa_security (doesn't need code changes)
2. **Create Dockerfiles** (can start immediately)
3. **Write runbook** (can start immediately)

### Do These Next
4. **Build + test Docker images** (depends on Dockerfiles)
5. **Wire `/upload` form** (depends on API being stable)

### Do These Last
6. **Create smoke test** (depends on everything else)
7. **Run full e2e flow** (final validation)

---

## Validation Checklist Before Deployment

```bash
# Local validation
[ ] docker-compose -f docker-compose.prod.yml up -d          # All services boot
[ ] curl http://localhost:3001/health                        # API responds
[ ] curl -F "file=@test.md" http://localhost:3001/ingest/upload  # Upload works
[ ] curl http://localhost:3001/jobs/<jobId>                 # Job status works
[ ] http://localhost:5173/incidents/                         # Web loads

# Staging validation
[ ] Deploy docker images to staging cluster
[ ] Run smoke test script on staging
[ ] Load test: 10 concurrent uploads
[ ] Monitor for 24 hours (no memory leaks)
[ ] Verify graceful shutdown works
[ ] Test rollback procedure

# Pre-production sign-off
[ ] QA sign-off on all tickets
[ ] Ops team signs off on runbook
[ ] Security review completed
[ ] Performance benchmarks met
[ ] Monitoring + alerting in place
```

---

## Summary

**Sprint 1 is implementation-ready but deployment-blocked.**

**Critical path to production (in order):**
1. ❌ QA reviews (4 tickets)
2. ❌ Dockerfiles + images
3. ❌ Runbook
4. ❌ `/upload` form wiring
5. ❌ Smoke tests

**Estimated total effort:** 15–25 hours  
**Recommended timeline:** 2–3 days (full-time focus)

**Go / No-Go:** 🔴 **DO NOT DEPLOY** until all items above are complete.

Good luck! 🚀
