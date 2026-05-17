import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import { answerQuestion, QaValidationError } from "../lib/qa.js";
import { requireQa } from "../middleware/auth.js";
import { qaLimiter } from "../middleware/rateLimit.js";


export const qaRouter = Router();

qaRouter.post("/qa", requireQa, qaLimiter, async (req, res) => {

  const started = Date.now();
  try {
    const result = await answerQuestion(prisma, req.body);
    const audit = await writeAuditLog(prisma, req, {
      action: result.audit.action,
      route: "/qa",
      method: "POST",
      status: result.status,
      statusCode: 200,
      latencyMs: Date.now() - started,
      promptVersion: result.promptVersion,
      provider: result.model.provider,
      model: result.model.name,
      modelVersion: result.model.version,
      input: {
        question: req.body?.question ?? null,
        filters: req.body?.filters ?? null,
        options: req.body?.options ?? null,
      },
      output: {
        status: result.status,
        citationCount: result.citations.length,
        confidence: result.confidence,
        refusalCode: result.refusal?.reasonCode ?? null,
      },
      retrievedSectionIds: result.audit.retrievedSectionIds,
      retrievedIncidentIds: result.audit.retrievedIncidentIds,
      refusalCode: result.audit.refusalCode,
      metadata: {
        evidenceCount: result.evidenceCount,
        sourceIncidentCount: result.sourceIncidents.length,
      },
    });

    const { audit: _audit, ...payload } = result;
    return res.json({ ...payload, auditId: audit?.id ?? null });
  } catch (error) {
    if (error instanceof QaValidationError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("[qa] answer failed:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
