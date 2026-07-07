import { logger } from "../lib/logger.js";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  EvalValidationError,
  getLatestEvalReport,
  runEval,
  upsertEvalQueries,
} from "../lib/eval.js";
import { requireAdmin, requireRead } from "../middleware/auth.js";
import { evalQueriesLimiter, evalRunsLimiter, evalLatestLimiter } from "../middleware/rateLimit.js";


export const evalRouter = Router();

evalRouter.post("/eval/queries", requireAdmin, evalQueriesLimiter, async (req, res) => {

  const started = Date.now();
  try {
    const result = await upsertEvalQueries(prisma, req.body);
    await writeAuditLog(prisma, req, {
      action: "eval.queries_upsert",
      route: "/eval/queries",
      method: "POST",
      status: "accepted",
      statusCode: 200,
      latencyMs: Date.now() - started,
      input: req.body,
      output: {
        querySetVersion: result.querySetVersion,
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
      },
      metadata: {
        querySetVersion: result.querySetVersion,
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
      },
    });
    return res.json(result);
  } catch (error) {
    if (error instanceof EvalValidationError) {
      return res.status(error.status).json({ error: error.message });
    }
    logger.error("[eval] query upsert failed:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

evalRouter.post("/eval/run", requireAdmin, evalRunsLimiter, async (req, res) => {

  const started = Date.now();
  try {
    const result = await runEval(prisma, req.body);
    await writeAuditLog(prisma, req, {
      action: "eval.run",
      route: "/eval/run",
      method: "POST",
      status: result.status,
      statusCode: 201,
      latencyMs: Date.now() - started,
      input: req.body,
      output: {
        runId: result.runId,
        status: result.status,
        metrics: result.metrics,
        failureCount: result.failures.length,
      },
      artifactPath: result.artifactPath,
      metadata: {
        runId: result.runId,
        querySetVersion: result.querySetVersion,
        mode: result.mode,
        failureCount: result.failures.length,
      },
    });
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof EvalValidationError) {
      return res.status(error.status).json({ error: error.message });
    }
    logger.error("[eval] run failed:", error);
    return res.status(500).json({ error: "Eval runner error" });
  }
});

evalRouter.get("/eval/latest", requireRead, evalLatestLimiter, async (_req, res) => {

  try {
    const result = await getLatestEvalReport(prisma);
    if (!result) {
      return res.status(404).json({ error: "No eval run has completed" });
    }
    
    const incidentCount = await prisma.incident.count();
    if (incidentCount < 500) {
      result.smallSampleWarning = true;
    }
    
    return res.json(result);
  } catch (error) {
    logger.error("[eval] latest failed:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
