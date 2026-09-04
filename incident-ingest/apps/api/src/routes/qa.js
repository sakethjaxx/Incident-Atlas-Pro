import { logger } from "../lib/logger.js";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import { answerQuestion, validateQaRequest, QaValidationError } from "../lib/qa.js";
import { requireQa } from "../middleware/auth.js";
import { qaLimiter } from "../middleware/rateLimit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const qaRouter = Router();

function buildAuditEntry(req, result, startedAt) {
  return {
    action: result.audit.action,
    route: "/qa",
    method: "POST",
    status: result.status,
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    promptVersion: result.promptVersion,
    provider: result.model.provider,
    model: result.model.name,
    modelVersion: result.model.version,
    input: {
      question: req.body?.question ?? null,
      filters: req.body?.filters ?? null,
      scope: req.body?.scope ?? null,
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
  };
}

qaRouter.post("/qa", requireQa, qaLimiter, async (req, res) => {
  const started = Date.now();
  try {
    const result = await answerQuestion(prisma, req.body);
    const audit = await writeAuditLog(prisma, req, buildAuditEntry(req, result, started));

    const { audit: _audit, ...payload } = result;
    return res.json({ ...payload, auditId: audit?.id ?? null });
  } catch (error) {
    if (error instanceof QaValidationError) {
      return res.status(error.status).json({ error: error.message });
    }
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ error: error.message });
    }
    logger.error("[qa] answer failed:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// SSE streaming variant (W6-033): tokens stream live from the Ollama generation
// path as they're produced; the answer is only "final" — citation-validated,
// audit-logged — once the "done" event fires. Validate the request BEFORE
// switching the response into event-stream mode, since headers/status can't
// change after the stream starts.
qaRouter.post("/qa/stream", requireQa, qaLimiter, async (req, res) => {
  try {
    validateQaRequest(req.body);
  } catch (error) {
    if (error instanceof QaValidationError) {
      return res.status(error.status).json({ error: error.message });
    }
    logger.error("[qa] stream validation failed:", error);
    return res.status(500).json({ error: "Internal server error" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const started = Date.now();

  try {
    const result = await answerQuestion(prisma, req.body, {
      onToken: (token) => send("token", { token }),
    });
    const audit = await writeAuditLog(prisma, req, buildAuditEntry(req, result, started));

    const { audit: _audit, ...payload } = result;
    send("done", { ...payload, auditId: audit?.id ?? null });
  } catch (error) {
    logger.error("[qa] stream answer failed:", error);
    send("error", { error: "Internal server error" });
  } finally {
    res.end();
  }
});

// W6-032 — Q&A feedback loop. Stored directly against the audit log row
// already written for the answer, so feedback and the answer it judges stay
// on one record.
qaRouter.post("/qa/:auditId/feedback", requireQa, qaLimiter, async (req, res) => {
  const { auditId } = req.params;
  if (!UUID_RE.test(auditId)) {
    return res.status(400).json({ error: "Invalid audit ID format" });
  }

  const { helpful } = req.body ?? {};
  if (typeof helpful !== "boolean") {
    return res.status(400).json({ error: "helpful must be a boolean" });
  }

  try {
    const updated = await prisma.auditLog.updateMany({
      where: { id: auditId, action: { in: ["qa.answer", "qa.refuse"] } },
      data: { feedbackHelpful: helpful, feedbackAt: new Date() },
    });
    if (updated.count === 0) {
      return res.status(404).json({ error: "Audit log not found" });
    }
    return res.json({ auditId, helpful });
  } catch (error) {
    logger.error("[qa] feedback write failed:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
