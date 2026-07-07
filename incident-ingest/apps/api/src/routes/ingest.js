import { Router } from "express";
import { Queue } from "bullmq";
import multer from "multer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { adminIngestLimiter } from "../middleware/rateLimit.js";
import { parseSections, summarize } from "@pkg/nlp";

import { redisConnection, PARSE_QUEUE_NAME } from "../lib/queue.js";
import { safeIndexIncidentEmbeddings, safeIndexIncidentGraph, uploadToStorage } from "@pkg/db";
import { safeIndexIncidentChunks } from "../lib/chunks.js";

const parsedMaxUploadFiles = Number.parseInt(
  process.env.MAX_UPLOAD_FILES ?? "",
  10
);
const MAX_UPLOAD_FILES =
  Number.isFinite(parsedMaxUploadFiles) && parsedMaxUploadFiles > 0
    ? parsedMaxUploadFiles
    : 20;

const MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_TYPES = ["text/plain", "text/markdown"];

function createUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
      files: MAX_UPLOAD_FILES,
    },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_UPLOAD_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type: ${file.mimetype}. Only .txt and .md are accepted.`));
      }
    },
  });
}

function getUploadedFiles(req) {
  if (Array.isArray(req.files)) return req.files;
  return [
    ...(req.files?.file ?? []),
    ...(req.files?.files ?? []),
  ];
}

export const ingestRouter = Router();

// Lazy-initialized queue: tests that do not hit queue-backed routes do not need Redis.
let _parseQueue = null;
function getParseQueue() {
  if (!_parseQueue) {
    _parseQueue = new Queue(PARSE_QUEUE_NAME, { connection: redisConnection });
  }
  return _parseQueue;
}

export function setParseQueueForTest(queue) {
  _parseQueue = queue;
}

function enqueueParseJob(documentId, jobId, metadata = {}) {
  return getParseQueue().add(
    "parse",
    { documentId, metadata },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    }
  );
}

/**
 * POST /ingest/upload
 * Multipart file upload. Accepts legacy field `file` and batch field `files`.
 *
 * Contract:
 *   - txt / md: rawText populated from file content; worker parses immediately
 *   - pdf: rawText = null; worker returns a permanent "not supported" error
 *   - returns { accepted, uploads[] }
 *   - single-file uploads also include top-level jobId/documentId for old clients
 */
ingestRouter.post(
  "/ingest/upload",
  requireAdmin,
  adminIngestLimiter,
  (req, res, next) => {
    createUploadMiddleware().fields([
      { name: "file", maxCount: MAX_UPLOAD_FILES },
      { name: "files", maxCount: MAX_UPLOAD_FILES },
    ])(req, res, (err) => {
      if (err) {
        if (err.message && err.message.startsWith("Unsupported file type")) {
          return res.status(400).json({ error: err.message });
        }
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File exceeds 10MB limit" });
        }
        if (err.code === "LIMIT_FILE_COUNT") {
          return res
            .status(413)
            .json({ error: `Batch exceeds ${MAX_UPLOAD_FILES} files` });
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return res
            .status(400)
            .json({ error: "Unexpected file field; use file or files" });
        }
        return next(err);
      }
      return next();
    });
  },
  async (req, res, next) => {
    try {
      const uploadedFiles = getUploadedFiles(req);
      if (uploadedFiles.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }
      const company = typeof req.body?.company === "string" ? req.body.company.trim() : "";
      if (!company) {
        return res.status(400).json({ error: "company is required" });
      }
      if (company.length > MAX_COMPANY_LENGTH) {
        return res.status(400).json({ error: `company must be ${MAX_COMPANY_LENGTH} characters or fewer` });
      }

      const preparedFiles = [];
      for (const uploadedFile of uploadedFiles) {
        const ext = path.extname(uploadedFile.originalname ?? "").toLowerCase();
        const isPdf = ext === ".pdf" || uploadedFile.mimetype === "application/pdf";

        const key = `uploads/${crypto.randomUUID()}${ext}`;
        await uploadToStorage(key, uploadedFile.buffer, uploadedFile.mimetype || "application/octet-stream");

        let rawText = null;
        if (!isPdf) {
          rawText = uploadedFile.buffer.toString("utf-8");
          if (!rawText.trim()) {
            return res.status(400).json({
              error: `Uploaded file is empty: ${uploadedFile.originalname}`,
            });
          }
        }

        preparedFiles.push({
          file: uploadedFile,
          key,
          rawText,
          hash: rawText
            ? crypto.createHash("sha256").update(rawText).digest("hex")
            : null,
        });
      }

      const uploads = [];
      for (const preparedFile of preparedFiles) {
        if (preparedFile.hash) {
          const existing = await prisma.document.findUnique({
            where: { hash: preparedFile.hash },
            include: { incident: true },
          });
          if (existing) {
            return res.status(409).json({
              error: "File already ingested",
              documentId: existing.id,
              incidentId: existing.incident?.id ?? null,
            });
          }
        }

        const doc = await prisma.document.create({
          data: {
            rawPath: preparedFile.key,
            rawText: preparedFile.rawText,
            hash: preparedFile.hash,
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
          bullJob = await enqueueParseJob(doc.id, doc.ingestJob.id, {
            company,
            visibility: "company_private",
          });
        } catch (queueError) {
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

        uploads.push({
          fileName: preparedFile.file.originalname,
          jobId: doc.ingestJob.id,
          documentId: doc.id,
          bullmqJobId: bullJob.id,
          pollUrl: `/jobs/${doc.ingestJob.id}`,
        });
      }

      const response = {
        accepted: uploads.length,
        uploads,
      };

      if (uploads.length === 1) {
        Object.assign(response, uploads[0]);
      }

      return res.status(202).json(response);
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * POST /ingest/manual
 * One-shot: parse rawText, create Incident + Sections immediately.
 * No Document/Job tracking. Fast path for manual uploads.
 * Requires admin auth.
 *
 * Body: { title: string, rawText: string, company?: string, date?: string,
 *         severity?: string, tags?: string[], sourceUrl?: string, products?: string[] }
 */
// Input limits — keep in sync with API_SPEC.md
const MAX_RAW_TEXT_BYTES = 100 * 1024; // 100 KB: prevents CPU-exhaustion in section parser
const MAX_TITLE_LENGTH = 500;
const MAX_COMPANY_LENGTH = 200;
const URL_RE = /^https?:\/\/.{1,2000}$/i;

ingestRouter.post(
  "/ingest/manual",
  requireAdmin,
  adminIngestLimiter,
  async (req, res, next) => {
    try {
      const { title, rawText, company, date, severity, tags, sourceUrl, products } =
        req.body ?? {};

      if (!title || typeof title !== "string") {
        return res.status(400).json({ error: "title is required" });
      }
      if (title.length > MAX_TITLE_LENGTH) {
        return res.status(400).json({ error: `title must be ${MAX_TITLE_LENGTH} characters or fewer` });
      }
      if (!rawText || typeof rawText !== "string") {
        return res.status(400).json({ error: "rawText is required" });
      }
      if (typeof company !== "string" || !company.trim()) {
        return res.status(400).json({ error: "company is required" });
      }
      // SEC: cap rawText to prevent CPU-exhaustion in the section parser
      if (Buffer.byteLength(rawText, "utf8") > MAX_RAW_TEXT_BYTES) {
        return res.status(400).json({ error: `rawText exceeds maximum size of ${MAX_RAW_TEXT_BYTES / 1024} KB` });
      }
      if (typeof company === "string" && company.length > MAX_COMPANY_LENGTH) {
        return res.status(400).json({ error: `company must be ${MAX_COMPANY_LENGTH} characters or fewer` });
      }
      if (sourceUrl !== undefined && sourceUrl !== null && sourceUrl !== "") {
        if (typeof sourceUrl !== "string" || !URL_RE.test(sourceUrl)) {
          return res.status(400).json({ error: "sourceUrl must be a valid http/https URL" });
        }
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
          company: company.trim(),
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

      // All are I/O-bound and independent — run concurrently.
      await Promise.all([
        safeIndexIncidentEmbeddings(prisma, incident),
        safeIndexIncidentGraph(prisma, incident),
        safeIndexIncidentChunks(prisma, incident),
      ]);

      return res.status(201).json(incident);
    } catch (error) {
      return next(error);
    }
  }
);

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
  adminIngestLimiter,
  async (req, res, next) => {
    try {
      const { documentId } = req.params;

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

      const company = typeof req.body?.company === "string" ? req.body.company.trim() : "";
      const bullJob = await enqueueParseJob(
        documentId,
        doc.ingestJob.id,
        company ? { company, visibility: "company_private" } : {}
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
