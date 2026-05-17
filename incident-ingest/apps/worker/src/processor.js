/**
 * Parse job processor — pure function, no Express dependency.
 *
 * Executed by the BullMQ Worker for every job on the 'parse' queue.
 * The job data must contain: { documentId: string }
 *
 * Text resolution strategy (in order):
 *   1. doc.rawText — already in DB (fastest path; used by /documents/upload and /ingest/manual)
 *   2. doc.rawPath — file on disk (used by /ingest/upload multipart)
 *      • .txt / .md  → read with utf-8
 *      • .pdf        → not yet supported (Sprint 2); returns permanent failure, no retry
 *      • other       → attempt utf-8 read; fail permanently if unreadable
 *
 * Stages:
 *   fetch   → load Document from DB; resolve rawText
 *   parse   → parseSections + summarize
 *   persist → create Incident + Sections rows
 *   done    → mark Document.parseStatus = done, IngestJob = success
 *
 * On any error: IngestJob.status = failed + error message persisted.
 * Permanent Prisma errors (P2002, P2003, P2016, P2025) and unsupported
 * file types are NOT retried.
 *
 * @module processor
 */

import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { parseSections, summarize } from "@pkg/nlp";
import { safeIndexIncidentEmbeddings } from "./retrieval.js";
import { safeIndexIncidentGraph } from "./graph.js";

// ── DB client ─────────────────────────────────────────────────────────────────

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

// ── Text resolution ───────────────────────────────────────────────────────────

/**
 * Permanent (non-retriable) error for unsupported content types.
 * Processor catches this and returns without re-throwing.
 */
class PermanentError extends Error {
  constructor(message) {
    super(message);
    this.permanent = true;
  }
}

/**
 * Resolve the raw text for a document.
 *
 * Priority:
 *   1. doc.rawText (in-DB)
 *   2. Read from doc.rawPath on disk
 *
 * @param {{ rawText: string|null, rawPath: string|null }} doc
 * @returns {Promise<string>}
 * @throws {PermanentError} for PDF or unresolvable.
 * @throws {Error} for transient I/O errors.
 */
export async function resolveRawText(doc) {
  if (doc.rawText) return doc.rawText;

  if (!doc.rawPath) {
    throw new PermanentError("Document has neither rawText nor rawPath");
  }

  const ext = path.extname(doc.rawPath).toLowerCase();

  if (ext === ".pdf") {
    throw new PermanentError(
      "PDF extraction is not yet supported (Sprint 2). " +
        "Please upload a .txt or .md file, or use POST /ingest/manual with rawText."
    );
  }

  // txt, md, or unknown — attempt utf-8 read
  try {
    const content = await readFile(doc.rawPath, "utf-8");
    if (!content.trim()) {
      throw new PermanentError("File at rawPath is empty");
    }
    return content;
  } catch (err) {
    if (err instanceof PermanentError) throw err;
    // ENOENT or other I/O errors — treat as transient (retriable) because
    // the file might be in the middle of being written.
    throw new Error(`Failed to read file at ${doc.rawPath}: ${err.message}`);
  }
}

// ── Processor ─────────────────────────────────────────────────────────────────

/**
 * Process a parse job.
 *
 * BullMQ retries this function automatically on throw (up to job.opts.attempts).
 * We only throw for transient / retriable errors. For permanent failures we
 * catch and persist the error message, then return normally so BullMQ marks
 * the job as "completed" with a failed result.
 *
 * @param {import('bullmq').Job<{documentId: string}>} job
 * @returns {Promise<{incidentId: string|null, error: string|null}>}
 */
export async function processParseJob(job) {
  const { documentId } = job.data;

  if (!documentId) {
    // Bad job data — don't retry
    return { incidentId: null, error: "Missing documentId in job data" };
  }

  // Mark job as running in DB (best-effort)
  await safeUpdateJob(documentId, {
    status: "running",
    stage: "fetch",
    startedAt: new Date(),
  });

  try {
    // ── Stage 1: fetch + resolve text ───────────────────────────────────
    await job.updateProgress(10);
    const doc = await prisma.document.findUnique({ where: { id: documentId } });

    if (!doc) {
      await safeUpdateJob(documentId, {
        status: "failed",
        error: `Document ${documentId} not found`,
        finishedAt: new Date(),
      });
      return { incidentId: null, error: `Document ${documentId} not found` };
    }

    let rawText;
    try {
      rawText = await resolveRawText(doc);
    } catch (resolveErr) {
      const permanent = resolveErr.permanent === true;
      const message = resolveErr.message;
      await safeUpdateJob(documentId, {
        status: "failed",
        error: message,
        finishedAt: new Date(),
      });
      await safeFail(documentId);
      if (permanent) {
        // Return without throwing — no retry for permanent failures
        return { incidentId: null, error: message };
      }
      throw resolveErr; // retriable I/O error
    }

    // ── Stage 2: parse ──────────────────────────────────────────────────
    await safeUpdateJob(documentId, { stage: "parse" });
    await job.updateProgress(40);

    const sections = parseSections(rawText);
    const summaryText = summarize(rawText);

    // ── Stage 3: persist ────────────────────────────────────────────────
    await safeUpdateJob(documentId, { stage: "persist" });
    await job.updateProgress(70);

    const incident = await prisma.incident.create({
      data: {
        documentId: doc.id,
        title: `Incident from doc ${doc.id.slice(0, 8)}`,
        summaryText,
        sections: { create: sections },
      },
      include: { sections: true },
    });

    await safeIndexIncidentEmbeddings(prisma, incident);

    // ── Stage 4 (Sprint 3): extract graph entities ───────────────────────
    // Graph extraction must NOT block or roll back ingest on failure.
    await job.updateProgress(85);
    await safeIndexIncidentGraph(prisma, incident);

    // ── Stage 5: mark done ──────────────────────────────────────────────
    await prisma.document.update({
      where: { id: documentId },
      data: { parseStatus: "done" },
    });
    await safeUpdateJob(documentId, {
      status: "success",
      stage: "done",
      finishedAt: new Date(),
      error: null,
    });

    await job.updateProgress(100);
    return { incidentId: incident.id, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await safeUpdateJob(documentId, {
      status: "failed",
      error: message,
      finishedAt: new Date(),
    });
    await safeFail(documentId);

    // W4-C1: Only re-throw for transient/retriable errors.
    // Permanent Prisma errors (constraint, not-found, etc.) must NOT be retried.
    const PERMANENT_PRISMA_CODES = new Set(["P2002", "P2003", "P2016", "P2025"]);
    const prismaCode = err?.code;
    if (
      (prismaCode && PERMANENT_PRISMA_CODES.has(prismaCode)) ||
      err.permanent === true
    ) {
      return { incidentId: null, error: message };
    }

    // Re-throw transient errors so BullMQ will retry.
    throw err;
  }
}

/** Best-effort IngestJob status update — never throws. */
async function safeUpdateJob(documentId, data) {
  try {
    await prisma.ingestJob.updateMany({ where: { documentId }, data });
  } catch (e) {
    console.warn(
      `[processor] safeUpdateJob failed for documentId=${documentId}:`,
      e?.message ?? e
    );
  }
}

/** Best-effort Document parseStatus = failed update. */
async function safeFail(documentId) {
  try {
    await prisma.document.updateMany({
      where: { id: documentId },
      data: { parseStatus: "failed" },
    });
  } catch (_) {}
}

export { prisma };
