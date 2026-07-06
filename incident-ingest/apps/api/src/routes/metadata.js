import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRead } from "../middleware/auth.js";
import { publicReadLimiter } from "../middleware/rateLimit.js";

export const metadataRouter = Router();

/**
 * GET /metadata/companies
 * Returns a unique list of companies from incidents.
 */
metadataRouter.get("/metadata/companies", requireRead, publicReadLimiter, async (req, res, next) => {
  try {
    const records = await prisma.incident.findMany({
      select: { company: true },
      where: { company: { not: null, not: "" } },
      distinct: ["company"],
      orderBy: { company: "asc" },
    });
    return res.json(records.map((r) => r.company));
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /metadata/severities
 * Returns a unique list of severities from incidents.
 */
metadataRouter.get("/metadata/severities", requireRead, publicReadLimiter, async (req, res, next) => {
  try {
    const records = await prisma.incident.findMany({
      select: { severity: true },
      where: { severity: { not: null, not: "" } },
      distinct: ["severity"],
      orderBy: { severity: "asc" },
    });
    return res.json(records.map((r) => r.severity));
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /metadata/tags
 * Returns a unique list of tags from incidents.
 */
metadataRouter.get("/metadata/tags", requireRead, publicReadLimiter, async (req, res, next) => {
  try {
    // Unnest tags array to get distinct values
    const result = await prisma.$queryRaw`SELECT DISTINCT unnest(tags) as tag FROM incidents WHERE array_length(tags, 1) > 0`;
    const tags = result.map((r) => r.tag).filter(Boolean).sort();
    return res.json(tags);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /metadata/nodes
 * Returns a unique list of graph node names, optionally filtered by type.
 */
metadataRouter.get("/metadata/nodes", requireRead, publicReadLimiter, async (req, res, next) => {
  try {
    const { type } = req.query;
    const where = type ? { nodeType: String(type) } : {};
    
    const nodes = await prisma.graphNode.findMany({
      select: { name: true },
      where,
      distinct: ["name"],
      orderBy: { name: "asc" },
    });
    
    return res.json(nodes.map((n) => n.name));
  } catch (error) {
    return next(error);
  }
});
