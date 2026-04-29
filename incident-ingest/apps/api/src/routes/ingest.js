import { Router } from "express";
import { Queue } from "bullmq";
import multer from "multer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { parseSections, summarize } from "@pkg/nlp";
import { redisConnection, PARSE_QUEUE_NAME } from "../lib/queue.js";
import { safeIndexIncidentEmbeddings } from "../lib/retrieval.js";

const upload = multer({
  dest: process.env.UPLOAD_DIR || "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB maximum size
  fileFilter: (_req, file, cb) => {
    // Only accept explicitly safe text/doc formats
    const allowedTypes = ["text/plain", "text/markdown", "application/pdf", "application/octet-stream"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`));
    }
  }
});

export const ingestRouter = Router();

// Lazy-initialised queue — only created when first needed so tests that don't
// hit this route don't need Redis to be running.
let _parseQueue = null;
function getParseQueue() {
  if (!_parseQueue) {
    _parseQueue = new Queue(PARSE_QUEUE_NAME, { connection: redisConnection });
  }
  return _parseQueue;
}

/**
 * POST /ingest/upload
 * Multipart file upload (txt, md; pdf accepted but deferred to Sprint 2)
 *
 * Contract:
 *   - txt / md: rawText populated from file content; worker parses immediately
 *   - pdf:      rawText = null; worker returns a permanent "not supported" error
 *               (sprint 2 will add proper PDF extraction)
 *   - Returns 202 with { jobId, documentId, bullmqJobId }
 */
ingestRouter.post(
  "/ingest/upload",
  requireAdmin,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        if (err.message && err.message.startsWith("Invalid file type")) {
          return res.status(400).json({ error: err.message });
        }
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File exceeds 10MB limit" });
        }
        return next(err);
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const ext = path.extname(req.file.originalname ?? "").toLowerCase();
      const isPdf = ext === ".pdf" || req.file.mimetype === "application/pdf";

      // For txt/md: read rawText now so the worker always has it in-DB.
      // For PDF: leave rawText null — worker will return a clear permanent error.
      let rawText = null;
      if (!isPdf) {
        try {
          rawText = await readFile(req.file.path, "utf-8");
          if (!rawText.trim()) {
            return res.status(400).json({ error: "Uploaded file is empty" });
          }
        } catch (readErr) {
          return next(new Error(`Failed to read uploaded file: ${readErr.message}`));
        }
      }

      const hash = rawText
        ? crypto.createHash("sha256").update(rawText).digest("hex")
        : null;

      const doc = await prisma.document.create({
        data: {
          rawPath: req.file.path,
          rawText,          // null for PDF; populated for txt/md
          hash,
          fetchedAt: new Date(),
          parseStatus: "pending",
          ingestJob: {
            create: {
              status: "queued",
              stage: "upload",
            },
          },
        },
        include: { ingestJob: true },
      });

      let bullJob;
      try {
        bullJob = await getParseQueue().add(
          "parse",
          { documentId: doc.id },
          {
            jobId: doc.ingestJob.id,
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 100 },
          }
        );
      } catch (queueError) {
        // Enqueue failed: mark as failed so it doesn't get stuck
        await prisma.document
          .updateMany({ where: { id: doc.id }, data: { parseStatus: "failed" } })
          .catch(() => {});
        await prisma.ingestJob
          .updateMany({
            where: { id: doc.ingestJob.id },
            data: { status: "failed", error: "Queue processing failed to start" },
          })
          .catch(() => {});
        throw queueError;
      }

      return res.status(202).json({
        jobId: doc.ingestJob.id,
        documentId: doc.id,
        bullmqJobId: bullJob.id,
        pollUrl: `/jobs/${doc.ingestJob.id}`,
      });
    } catch (error) {
      return next(error);
    }
  }
);


/**
 * POST /ingest/manual
 * One-shot: parse rawText, create Incident + Sections immediately (sync).
 * No Document/Job tracking — fast path for manual uploads.
 * Requires admin auth.
 *
 * Body: { title: string, rawText: string, company?: string, date?: string,
 *         severity?: string, tags?: string[], sourceUrl?: string, products?: string[] }
 */
ingestRouter.post("/ingest/manual", requireAdmin, async (req, res, next) => {
  try {
    const { title, rawText, company, date, severity, tags, sourceUrl, products } =
      req.body ?? {};

    if (!title || typeof title !== "string") {
      return res.status(400).json({ error: "title is required" });
    }
    if (!rawText || typeof rawText !== "string") {
      return res.status(400).json({ error: "rawText is required" });
    }

    let parsedDate = null;
    if (date) {
      const candidate = new Date(date);
      if (Number.isNaN(candidate.getTime())) {
        return res.status(400).json({ error: "date must be ISO-8601" });
      }
      parsedDate = candidate;
    }

    const sections = parseSections(rawText);
    const summaryText = summarize(rawText);

    const incident = await prisma.incident.create({
      data: {
        title: title.trim(),
        company: typeof company === "string" ? company.trim() : null,
        date: parsedDate,
        severity: typeof severity === "string" ? severity.trim() : null,
        tags: Array.isArray(tags) ? tags : [],
        products: Array.isArray(products) ? products : [],
        sourceUrl: typeof sourceUrl === "string" ? sourceUrl.trim() : null,
        summaryText,
        sections: { create: sections },
      },
      include: { sections: true },
    });

    await safeIndexIncidentEmbeddings(prisma, incident);

    return res.status(201).json(incident);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /ingest/:documentId
 * Enqueue an async parse job for an already-uploaded document.
 * Returns 202 Accepted with { jobId, bullmqJobId } immediately.
 * The BullMQ worker processes the job in the background.
 * Requires admin auth.
 */
ingestRouter.post(
  "/ingest/:documentId",
  requireAdmin,
  async (req, res, next) => {
    try {
      const { documentId } = req.params;

      // Verify the document + job exist
      const doc = await prisma.document.findUnique({
        where: { id: documentId },
        include: { ingestJob: true },
      });

      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }

      if (!doc.ingestJob) {
        return res
          .status(400)
          .json({ error: "No IngestJob found for this document" });
      }

      if (doc.ingestJob.status === "running") {
        return res
          .status(409)
          .json({ error: "Ingestion already in progress for this document" });
      }

      // Enqueue — worker picks it up asynchronously
      const bullJob = await getParseQueue().add(
        "parse",
        { documentId },
        {
          jobId: doc.ingestJob.id, // stable ID = IngestJob PK for easy polling
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        }
      );

      return res.status(202).json({
        message: "Job enqueued",
        jobId: doc.ingestJob.id,
        bullmqJobId: bullJob.id,
        pollUrl: `/jobs/${doc.ingestJob.id}`,
      });
    } catch (error) {
      return next(error);
    }
  }
);
