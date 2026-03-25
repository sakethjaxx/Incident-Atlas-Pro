import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";

export const sourcesRouter = Router();

/**
 * POST /sources
 * Register a new crawl source.
 * Requires admin auth.
 */
sourcesRouter.post("/sources", requireAdmin, async (req, res, next) => {
  try {
    const { name, url, type, crawlPolicy } = req.body ?? {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required" });
    }
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "url is required" });
    }

    const validTypes = ["blog", "statuspage", "github", "pdf", "manual"];
    const resolvedType = validTypes.includes(type) ? type : "manual";

    const source = await prisma.source.create({
      data: {
        name: name.trim(),
        url: url.trim(),
        type: resolvedType,
        crawlPolicy: crawlPolicy ?? null,
      },
    });

    return res.status(201).json(source);
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Source URL already registered" });
    }
    return next(error);
  }
});

/**
 * GET /sources
 * List all registered sources.
 */
sourcesRouter.get("/sources", async (_req, res, next) => {
  try {
    const sources = await prisma.source.findMany({
      orderBy: { createdAt: "desc" },
    });
    return res.json(sources);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /sources/:id
 * Get a single source.
 */
sourcesRouter.get("/sources/:id", async (req, res, next) => {
  try {
    const source = await prisma.source.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { documents: true } } },
    });
    if (!source) {
      return res.status(404).json({ error: "Source not found" });
    }
    return res.json(source);
  } catch (error) {
    return next(error);
  }
});
