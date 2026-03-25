import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const jobsRouter = Router();

/**
 * GET /jobs/:jobId
 * Poll ingestion job status.
 */
jobsRouter.get("/jobs/:jobId", async (req, res, next) => {
  try {
    const job = await prisma.ingestJob.findUnique({
      where: { id: req.params.jobId },
      include: {
        document: {
          select: { id: true, parseStatus: true, hash: true },
        },
      },
    });

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    return res.json(job);
  } catch (error) {
    return next(error);
  }
});
