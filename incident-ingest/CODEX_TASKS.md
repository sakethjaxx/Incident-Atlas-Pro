# Codex Execution Tasks — Incident Atlas Pro Sprint 1 Closure

**Date:** 2026-04-14  
**Status:** Sprint 1 code is complete but has 3 unfixed issues blocking release.  
**Goal:** Fix all 3, then run verification commands to confirm green.

Work entirely inside `incident-ingest/`. All paths below are relative to that directory.

---

## Task 1 — Fix Redis zombie after reconnect exhaustion

**File:** `apps/worker/src/worker.js`

**Problem:** ioredis silently exhausts its default retry ceiling (~8 retries, ~3 min) after Redis goes down. Once it gives up, the worker stays alive but never picks up another job. There is no `retryStrategy` that exits or alerts, and no liveness mechanism to detect the zombie state.

**Fix:** Add a `retryStrategy` to the ioredis connection options inside `parseRedisUrl()` in `worker.js`. After 10 consecutive failures, log an error and call `shutdown("redis-exhausted")` so the process exits and the container restarts cleanly.

**Exact change — in `worker.js`, find the `parseRedisUrl` function (around line 32) and replace it:**

```js
// BEFORE
function parseRedisUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || "localhost",
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
```

```js
// AFTER
const REDIS_MAX_RETRIES = 10;

function parseRedisUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || "localhost",
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      if (times > REDIS_MAX_RETRIES) {
        console.error(
          `[worker] Redis unreachable after ${REDIS_MAX_RETRIES} retries — shutting down`
        );
        // Call shutdown asynchronously so ioredis can return first
        setImmediate(() => shutdown("redis-exhausted"));
        return null; // tells ioredis to stop retrying
      }
      // Exponential backoff: 200ms, 400ms, 800ms … capped at 5s
      return Math.min(200 * 2 ** (times - 1), 5000);
    },
  };
}
```

**Acceptance:** Worker exits non-zero when Redis is unreachable for 10 consecutive retries instead of zombieing silently.

---

## Task 2 — Fix `uploadFile` missing Authorization header

**File:** `apps/web/src/lib/api.ts`

**Problem:** `uploadFile()` (line ~113) calls `POST /ingest/upload` with no `Authorization` header. The `requireAdmin` middleware on that route passes silently in dev (no `ADMIN_TOKEN` set), but in production with `ADMIN_TOKEN` set every upload returns 401 with no actionable error for the user.

**Fix:** Read `VITE_ADMIN_TOKEN` from env and attach it as a Bearer token when present. Do not make it required — absence means dev mode, matching existing middleware behaviour.

**Exact change — in `apps/web/src/lib/api.ts`, replace the `uploadFile` function:**

```ts
// BEFORE
export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}/ingest/upload`, {
    method: "POST",
    body: formData,
    // Note: Do NOT set Content-Type header. The browser automatically sets it
    // to multipart/form-data with the correct boundary parameter.
  });

  if (!res.ok) {
    let message = `Upload failed: ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data.error === "string") {
        message = data.error;
      }
    } catch {
      // Ignore
    }
    throw new Error(message);
  }

  return res.json() as Promise<UploadResponse>;
}
```

```ts
// AFTER
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN as string | undefined;

export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const headers: HeadersInit = {};
  if (ADMIN_TOKEN) {
    headers["Authorization"] = `Bearer ${ADMIN_TOKEN}`;
  }

  const res = await fetch(`${API_URL}/ingest/upload`, {
    method: "POST",
    body: formData,
    headers,
    // Note: Do NOT set Content-Type header. The browser automatically sets it
    // to multipart/form-data with the correct boundary parameter.
  });

  if (!res.ok) {
    let message = `Upload failed: ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data.error === "string") {
        message = data.error;
      }
    } catch {
      // Ignore
    }
    throw new Error(message);
  }

  return res.json() as Promise<UploadResponse>;
}
```

**Also add `VITE_ADMIN_TOKEN` to the web env example file `apps/web/.env.example`:**

```
# Optional — only needed when the API has ADMIN_TOKEN set (production).
# Leave blank for local dev.
VITE_ADMIN_TOKEN=
```

**Acceptance:** Upload works in dev (no token) and in production (token sent as Bearer when `VITE_ADMIN_TOKEN` is set in `.env`).

---

## Task 3 — Add worker liveness health check endpoint

**Problem:** There is no way for Docker / a process supervisor to know if the worker is alive but zombied (connected to process but not connected to Redis). The API has `GET /health` but the worker has no equivalent.

**Fix:** Create a new file `apps/worker/src/health.js` that writes a heartbeat file to disk every 10 seconds while the worker is running. The Docker healthcheck reads this file. If the file is older than 30 seconds, the container is marked unhealthy and restarted.

**Create `apps/worker/src/health.js`:**

```js
/**
 * Heartbeat-based liveness probe for the worker process.
 *
 * Writes a small JSON file to HEALTH_FILE_PATH every HEARTBEAT_INTERVAL_MS.
 * Docker / process supervisors can check the file's mtime to detect zombies.
 *
 * Usage: call startHeartbeat() at worker startup, stopHeartbeat() on shutdown.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

const HEALTH_FILE_PATH =
  process.env.WORKER_HEALTH_FILE ?? join(os.tmpdir(), "worker-heartbeat.json");

const HEARTBEAT_INTERVAL_MS = 10_000; // 10 s

let _timer = null;

async function writeHeartbeat() {
  try {
    await writeFile(
      HEALTH_FILE_PATH,
      JSON.stringify({ ok: true, ts: new Date().toISOString(), pid: process.pid }),
      "utf-8"
    );
  } catch (err) {
    console.warn("[worker:health] Failed to write heartbeat:", err.message);
  }
}

export function startHeartbeat() {
  writeHeartbeat(); // write immediately on start
  _timer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
  _timer.unref(); // don't prevent process exit
  console.log(`[worker:health] Heartbeat writing to ${HEALTH_FILE_PATH} every ${HEARTBEAT_INTERVAL_MS / 1000}s`);
}

export function stopHeartbeat() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

export { HEALTH_FILE_PATH };
```

**Update `apps/worker/src/worker.js` to use the heartbeat:**

At the top of the file, add the import after the existing imports:
```js
import { startHeartbeat, stopHeartbeat } from "./health.js";
```

In the `worker.on("ready", ...)` handler, add `startHeartbeat()`:
```js
// BEFORE
worker.on("ready", () => {
  console.log(
    `[worker] ✓ Listening on queue "${QUEUE_NAME}" (concurrency=${concurrency}, redis=${redisUrl})`
  );
});
```
```js
// AFTER
worker.on("ready", () => {
  console.log(
    `[worker] ✓ Listening on queue "${QUEUE_NAME}" (concurrency=${concurrency}, redis=${redisUrl})`
  );
  startHeartbeat();
});
```

In the `shutdown()` function's `finally` block, add `stopHeartbeat()` before `prisma.$disconnect()`:
```js
// BEFORE
  } finally {
    await prisma.$disconnect().catch((e) =>
      console.error("[worker] Prisma disconnect error:", e.message)
    );
    process.exit(exitCode);
  }
```
```js
// AFTER
  } finally {
    stopHeartbeat();
    await prisma.$disconnect().catch((e) =>
      console.error("[worker] Prisma disconnect error:", e.message)
    );
    process.exit(exitCode);
  }
```

**Update `docker-compose.yaml` — add the worker service with a healthcheck:**

The current `docker-compose.yaml` only has `db` and `redis`. Add a `worker` service block after the `redis` service:

```yaml
  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    container_name: incident_ingest_worker
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/incident_ingest
      REDIS_URL: redis://redis:6379
      WORKER_CONCURRENCY: "2"
    healthcheck:
      test: ["CMD-SHELL", "test $(( $(date +%s) - $(date -r /tmp/worker-heartbeat.json +%s 2>/dev/null || echo 0) )) -lt 30"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 15s
    restart: unless-stopped
```

**Note:** This requires a `apps/worker/Dockerfile`. If it does not exist yet, create it:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/ ./packages/

RUN npm install -g pnpm && pnpm install --filter @app/worker --filter @pkg/nlp

COPY apps/worker ./apps/worker
COPY packages ./packages

ENV NODE_ENV=production

CMD ["node", "apps/worker/src/worker.js"]
```

**Acceptance:** `docker compose up worker` starts the worker, writes `/tmp/worker-heartbeat.json` every 10s, and the healthcheck passes.

---

## Verification — Run After All 3 Tasks

Run these commands in order from `incident-ingest/`:

```bash
# 1. Boot infrastructure
docker compose up -d --wait
# Expected: db and redis both show "healthy"

# 2. Run all unit tests (no DB/Redis needed)
pnpm --filter @app/worker test
pnpm --filter @app/api test:unit
# Expected: all tests green

# 3. Run integration tests (needs Postgres)
pnpm --filter @app/api test:integration
# Expected: all 6 upload→worker→incident tests green

# 4. Manual e2e smoke check
# Start API and worker in two terminals:
#   pnpm --filter @app/api dev
#   pnpm --filter @app/worker dev   (or: node apps/worker/src/worker.js)
#
# Then upload a test file:
curl -X POST http://localhost:3001/ingest/upload \
  -F "file=@test-incident.txt" \
  | jq .
# Expected: { "jobId": "<uuid>", "documentId": "<uuid>", ... }

# 5. Poll job status until completed
JOB_ID=<jobId from above>
curl http://localhost:3001/jobs/$JOB_ID | jq .
# Expected: { "status": "completed", "result": { "incidentId": "<uuid>" } }

# 6. Verify incident was created
INCIDENT_ID=<incidentId from above>
curl http://localhost:3001/incidents/$INCIDENT_ID | jq .
# Expected: full incident object with sections array
```

All 6 steps must pass before Sprint 1 can be marked complete.

---

## What NOT to change

- Do not modify `apps/api/src/routes/ingest.js` — the rawText-at-upload fix is already in place.
- Do not modify `apps/worker/src/processor.js` — `resolveRawText` is already correct.
- Do not modify `apps/web/src/routes/Upload.tsx` — the async polling UI is already implemented.
- Do not touch `packages/nlp/` — 40 tests pass, NLP is complete.
- Do not start Sprint 2 work (embeddings, vector search, URL crawl) until all 6 verification steps above pass.
