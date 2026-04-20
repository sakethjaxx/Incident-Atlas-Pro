/**
 * BullMQ Worker entrypoint — processes jobs from the 'parse' queue.
 *
 * Graceful shutdown contract:
 *   1. On SIGTERM/SIGINT, call worker.close(false) which stops polling
 *      and waits for the current in-flight job to finish.
 *   2. Close Prisma connection (always, even if close() throws).
 *   3. Exit 0; exit 1 if drain/disconnect throws or drain exceeds
 *      CLOSE_TIMEOUT_MS.
 */

import "dotenv/config";
import { Worker } from "bullmq";
import { processParseJob, prisma } from "./processor.js";
import { startHeartbeat, stopHeartbeat } from "./health.js";

// ── Config ────────────────────────────────────────────────────────────────────

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
// W4-C2: Guard against NaN/0 — both cause BullMQ to process zero jobs silently.
const _rawConcurrency = Number(process.env.WORKER_CONCURRENCY ?? "2");
const concurrency = Number.isFinite(_rawConcurrency) && _rawConcurrency >= 1
  ? Math.floor(_rawConcurrency)
  : 2;
if (!Number.isFinite(_rawConcurrency) || _rawConcurrency < 1) {
  console.warn(
    `[worker] WORKER_CONCURRENCY="${process.env.WORKER_CONCURRENCY}" is invalid — defaulting to 2`
  );
}
const QUEUE_NAME = "parse";
const CLOSE_TIMEOUT_MS = 30_000; // 30 s max drain time

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

// ── Worker ────────────────────────────────────────────────────────────────────

// W4-M1: `defaultJobOptions` is a Queue property, not a Worker property — it has no
// effect here. Retry config is set at enqueue time in apps/api/src/routes/ingest.js.
const worker = new Worker(QUEUE_NAME, processParseJob, {
  connection: parseRedisUrl(redisUrl),
  concurrency,
});

// ── Lifecycle events ──────────────────────────────────────────────────────────

worker.on("ready", () => {
  console.log(
    `[worker] ✓ Listening on queue "${QUEUE_NAME}" (concurrency=${concurrency}, redis=${redisUrl})`
  );
  startHeartbeat();
});

worker.on("active", (job) => {
  console.log(`[worker] → Processing job ${job.id} | documentId=${job.data.documentId}`);
});

worker.on("completed", (job, result) => {
  if (result?.error) {
    console.warn(`[worker] ✗ Job ${job.id} completed with data error: ${result.error}`);
  } else {
    console.log(`[worker] ✓ Job ${job.id} done | incidentId=${result?.incidentId}`);
  }
});

worker.on("failed", (job, err) => {
  const attemptsLeft = (job?.opts?.attempts ?? 1) - (job?.attemptsMade ?? 1);
  console.error(
    `[worker] ✗ Job ${job?.id} failed (${attemptsLeft} retries left): ${err.message}`
  );
});

worker.on("error", (err) => {
  // Redis connection errors — BullMQ will auto-reconnect
  console.error("[worker] Redis error:", err.message);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received — draining in-flight jobs (max ${CLOSE_TIMEOUT_MS / 1000}s)...`);

  // W4-H1: Use a flag so the timeout callback knows drain already completed
  // before it fires, preventing a race between clearTimeout and the callback.
  let drainCompleted = false;
  const timer = setTimeout(() => {
    if (drainCompleted) return; // drain beat the timeout — don't clobber exit
    console.error("[worker] Drain timeout exceeded — forcing exit");
    process.exit(1);
  }, CLOSE_TIMEOUT_MS);
  timer.unref();

  // W4-H2: Disconnect Prisma in finally so it always runs, even if close() throws.
  let exitCode = 0;
  try {
    // false = wait for active jobs; true would abandon them
    await worker.close(false);
    drainCompleted = true;
    clearTimeout(timer);
    console.log("[worker] Clean shutdown complete.");
  } catch (err) {
    drainCompleted = true;
    clearTimeout(timer);
    console.error("[worker] Error during shutdown:", err.message);
    exitCode = 1;
  } finally {
    stopHeartbeat();
    await prisma.$disconnect().catch((e) =>
      console.error("[worker] Prisma disconnect error:", e.message)
    );
    process.exit(exitCode);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// W4-QA-H1: Catch unhandled rejections / exceptions so the process can drain
// jobs and disconnect Prisma rather than crashing immediately.
process.on("unhandledRejection", (reason) => {
  console.error("[worker] Unhandled rejection:", reason);
  shutdown("unhandledRejection");
});
process.on("uncaughtException", (err) => {
  console.error("[worker] Uncaught exception:", err);
  shutdown("uncaughtException");
});
