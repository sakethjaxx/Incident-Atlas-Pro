import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { splitSections, buildSummary } from "../lib/parser.js";
import { runIngest } from "../lib/ingestRunner.js";

export const ingestRouter = Router();

/**
 * POST /ingest/manual
 * One-shot: parse rawText, create Incident + Sections immediately.
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

    const sections = splitSections(rawText);
    const summaryText = buildSummary(rawText);

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

    return res.status(201).json(incident);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /ingest/:documentId
 * Run the ingestion pipeline for an already-uploaded document.
 * Updates IngestJob stage/status throughout.
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

      // Run synchronously (MVP — no queue)
      const result = await runIngest(documentId);

      const status = result.jobStatus === "success" ? 200 : 422;
      return res.status(status).json(result);
    } catch (error) {
      return next(error);
    }
  }
);
