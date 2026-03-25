import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import crypto from "crypto";

export const documentsRouter = Router();

/**
 * POST /documents/upload
 * Upload a raw text document and create an IngestJob for it.
 * Requires admin auth.
 *
 * Body: { rawText: string, sourceId?: string }
 */
documentsRouter.post(
  "/documents/upload",
  requireAdmin,
  async (req, res, next) => {
    try {
      const { rawText, sourceId } = req.body ?? {};

      if (!rawText || typeof rawText !== "string") {
        return res.status(400).json({ error: "rawText is required" });
      }

      const hash = crypto
        .createHash("sha256")
        .update(rawText)
        .digest("hex");

      const document = await prisma.document.create({
        data: {
          rawText,
          hash,
          fetchedAt: new Date(),
          parseStatus: "pending",
          sourceId: sourceId ?? null,
          ingestJob: {
            create: {
              status: "queued",
              stage: "queued",
            },
          },
        },
        include: { ingestJob: true },
      });

      return res.status(201).json(document);
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * GET /documents/:id
 * Get document status and associated parsed artifacts (incident + sections).
 */
documentsRouter.get("/documents/:id", async (req, res, next) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: {
        ingestJob: true,
        incident: {
          include: { sections: true },
        },
      },
    });

    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    return res.json(document);
  } catch (error) {
    return next(error);
  }
});
