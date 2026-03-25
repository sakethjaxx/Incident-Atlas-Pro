import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const incidentsRouter = Router();

/**
 * GET /incidents
 * List incidents with optional pagination.
 * Query: page (1-based), limit (default 20, max 100)
 */
incidentsRouter.get("/incidents", async (req, res, next) => {
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
 */
incidentsRouter.get("/incidents/:id", async (req, res, next) => {
  try {
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
 * GET /incidents/:id/similar
 * Placeholder: returns empty list.
 * Sprint 2 will populate this with vector similarity + reasons.
 */
incidentsRouter.get("/incidents/:id/similar", async (req, res, next) => {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });

    if (!incident) {
      return res.status(404).json({ error: "Incident not found" });
    }

    // TODO Sprint 2: vector similarity search + reranking
    return res.json({ data: [], note: "Vector similarity — coming in Sprint 2" });
  } catch (error) {
    return next(error);
  }
});
