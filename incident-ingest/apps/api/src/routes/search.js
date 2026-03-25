import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const searchRouter = Router();

/**
 * GET /search
 * Keyword search (Postgres ILIKE) over incident title, summaryText, and section text.
 *
 * Query params:
 *   q        (string, required)  — search query
 *   from     (ISO date)          — incident date >= from
 *   to       (ISO date)          — incident date <= to
 *   company  (string)            — exact match on company
 *   tag      (string)            — incident must contain this tag
 *   page     (int, default 1)
 *   limit    (int, default 20, max 50)
 *
 * NOTE: This is a best-effort keyword search (ILIKE).
 * Sprint 2 will upgrade to Postgres FTS (tsvector) + vector similarity + reranking.
 */
searchRouter.get("/search", async (req, res, next) => {
  try {
    const q = (req.query.q ?? "").trim();
    if (!q) {
      return res.status(400).json({ error: "q query parameter is required" });
    }

    const page = Math.max(1, parseInt(req.query.page ?? "1", 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? "20", 10) || 20));
    const skip = (page - 1) * limit;

    // Build date filters
    const dateFilter = {};
    if (req.query.from) {
      const from = new Date(req.query.from);
      if (!Number.isNaN(from.getTime())) dateFilter.gte = from;
    }
    if (req.query.to) {
      const to = new Date(req.query.to);
      if (!Number.isNaN(to.getTime())) dateFilter.lte = to;
    }

    const where = {
      AND: [
        // Text match across title, summary, and sections
        {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { summaryText: { contains: q, mode: "insensitive" } },
            {
              sections: {
                some: { text: { contains: q, mode: "insensitive" } },
              },
            },
          ],
        },
        // Optional filters
        ...(Object.keys(dateFilter).length ? [{ date: dateFilter }] : []),
        ...(req.query.company
          ? [{ company: { equals: req.query.company, mode: "insensitive" } }]
          : []),
        ...(req.query.tag ? [{ tags: { has: req.query.tag } }] : []),
      ],
    };

    const [total, incidents] = await Promise.all([
      prisma.incident.count({ where }),
      prisma.incident.findMany({
        where,
        include: {
          sections: {
            where: { text: { contains: q, mode: "insensitive" } },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
      }),
    ]);

    return res.json({ data: incidents, total, page, limit, q });
  } catch (error) {
    return next(error);
  }
});
