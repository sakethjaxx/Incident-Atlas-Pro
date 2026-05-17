import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { findSimilarIncidents } from "../lib/retrieval.js";
import { requireRead } from "../middleware/auth.js";
import { publicReadLimiter } from "../middleware/rateLimit.js";


export const incidentsRouter = Router();

/** UUID v4 format guard — prevents nonsense IDs from reaching Postgres */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * GET /incidents
 * List incidents with optional pagination.
 * Query: page (1-based), limit (default 20, max 100)
 */
incidentsRouter.get("/incidents", requireRead, publicReadLimiter, async (req, res, next) => {

  try {
    const page = Math.max(1, parseInt(req.query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "20", 10) || 20));
    const skip = (page - 1) * limit;

    const [total, incidents] = await Promise.all([
      prisma.incident.count(),
      prisma.incident.findMany({
        select: {
          id: true,
          title: true,
          date: true,
          company: true,
          severity: true,
          tags: true,
          products: true,
          summaryText: true,
          createdAt: true,
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
      }),
    ]);

    return res.json({ data: incidents, total, page, limit });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /incidents/:id
 * Full incident detail including all sections.
 *
 * Errors:
 *   400  Malformed incident ID
 *   404  Incident not found
 */
incidentsRouter.get("/incidents/:id", requireRead, publicReadLimiter, async (req, res, next) => {

  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: "Invalid incident ID format" });
    }

    const incident = await prisma.incident.findUnique({
      where: { id: req.params.id },
      include: {
        sections: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!incident) {
      return res.status(404).json({ error: "Incident not found" });
    }

    return res.json(incident);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /incidents/:id/similar?limit=<n>
 *
 * Returns top-N similar incidents by embedding cosine distance on summary_embedding.
 * Falls back to in-memory cosine similarity when embeddings are unavailable.
 *
 * Response (frozen API_SPEC contract):
 *   {
 *     similar: [
 *       {
 *         incident: { id, title, severity, date, company, tags, products, summaryText, createdAt },
 *         score: 0.95,
 *         reason: "<human-readable string>",
 *         matchedSections: [{ id, type, text, score }]
 *       }
 *     ],
 *     total: <int>,
 *     limit: <int>
 *   }
 *
 * Errors:
 *   400  Malformed incident ID
 *   404  Incident not found
 */
incidentsRouter.get("/incidents/:id/similar", requireRead, publicReadLimiter, async (req, res, next) => {

  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: "Invalid incident ID format" });
    }

    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit ?? "5", 10) || 5));
    const rawData = await findSimilarIncidents(prisma, req.params.id, limit);

    if (rawData === null) {
      return res.status(404).json({ error: "Incident not found" });
    }

    // Map internal retrieval shape → frozen API_SPEC contract.
    // retrieval.js returns: { id, title, …, score, similarityReason, matchedSections }
    // Contract shape: { incident: {...}, score, reason, matchedSections }
    const similar = rawData.map((item) => ({
      incident: {
        id: item.id,
        title: item.title,
        date: item.date,
        company: item.company,
        severity: item.severity,
        tags: item.tags ?? [],
        products: item.products ?? [],
        summaryText: item.summaryText,
        createdAt: item.createdAt,
      },
      score: item.score,
      reason: item.similarityReason ?? "Similar incident pattern",
      matchedSections: (item.matchedSections ?? []).map((s) => ({
        id: s.id,
        type: s.type,
        text: s.text,
        score: s.score ?? null,
      })),
    }));

    return res.json({
      similar,
      // Keep `data` as a backward-compat alias so existing tests don't break
      data: similar,
      total: similar.length,
      limit,
    });
  } catch (error) {
    return next(error);
  }
});

