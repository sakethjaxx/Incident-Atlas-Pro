import { Router } from "express";
import { Queue } from "bullmq";
import { jobsLimiter } from "../middleware/rateLimit.js";
import { prisma } from "../lib/prisma.js";
import { redisConnection, PARSE_QUEUE_NAME } from "../lib/queue.js";

export const jobsRouter = Router();

// Same lazy pattern as ingest.js — avoids requiring Redis for non-job-related tests
let _queue = null;
function getQueue() {
  if (!_queue) _queue = new Queue(PARSE_QUEUE_NAME, { connection: redisConnection });
  return _queue;
}

/**
 * GET /jobs/:jobId
 *
 * Returns combined job status from:
 *   1. DB IngestJob row  (authoritative for our stage/error fields)
 *   2. BullMQ queue state (waiting/active/completed/failed/delayed)
 *
 * Response shape:
 *   {
 *     id, status, stage, error, startedAt, finishedAt, createdAt,
 *     bullmq: { state, progress, attemptsMade } | null,
 *     document: { id, parseStatus, hash }
 *   }
 */
jobsRouter.get("/jobs/:jobId", jobsLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;

    // W6-H1: Validate jobId to prevent Prisma exceptions breaking API contract
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(jobId)) {
      return res.status(400).json({ error: "Invalid job ID format" });
    }

    // Fast path: try BullMQ first to avoid DB round-trip
    try {
      const bullJob = await getQueue().getJob(jobId);
      if (bullJob) {
        let state = await bullJob.getState();
        // Map BullMQ states to requested schema
        if (state === "delayed") state = "waiting";

        return res.json({
          id: jobId,
          status: state, // waiting, active, completed, failed
          progress: bullJob.progress,
          result: bullJob.returnvalue,
          error: bullJob.failedReason,
        });
      }
    } catch (_) {
      // If Redis is down or job not found, fall back to DB
    }

    // Fallback: Check DB if job was removed from queue
    const dbJob = await prisma.ingestJob.findUnique({
      where: { id: jobId },
      include: {
        document: { select: { id: true, parseStatus: true } },
      },
    });

    if (!dbJob) {
      return res.status(404).json({ error: "Job not found" });
    }

    // Map DB status to requested schema
    let status = dbJob.status;
    if (status === "queued") status = "waiting";
    if (status === "running") status = "active";
    if (status === "success" || status === "done") status = "completed";

    return res.json({
      id: dbJob.id,
      status,
      error: dbJob.error,
      documentId: dbJob.documentId,
      parseStatus: dbJob.document?.parseStatus,
    });
  } catch (error) {
    return next(error);
  }
});
