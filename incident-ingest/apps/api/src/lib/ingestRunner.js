/**
 * Synchronous ingestion pipeline runner.
 *
 * Stages:
 * 1. Validate document exists
 * 2. Parse (split sections + build summary)
 * 3. Create Incident + Sections
 * 4. Update Document.parseStatus = done
 * 5. Update IngestJob stage/status = done/success
 *
 * On any error: saves error message, sets job status = failed, still commits
 * whatever partial data was persisted prior to the failure.
 *
 * @param {string} documentId
 * @param {import('../lib/prisma.js').prisma} db  - PrismaClient instance
 * @param {import('../lib/parser.js')} parser
 * @returns {Promise<{incident: object|null, error: string|null}>}
 */

import { splitSections, buildSummary } from "./parser.js";
import { prisma } from "./prisma.js";

/**
 * Run the ingestion pipeline for the given documentId.
 *
 * @param {string} documentId
 * @returns {Promise<{incident: object|null, jobStatus: string, error: string|null}>}
 */
export async function runIngest(documentId) {
  // Mark job as running
  await prisma.ingestJob.updateMany({
    where: { documentId },
    data: {
      status: "running",
      stage: "fetch",
      startedAt: new Date(),
    },
  });

  try {
    // ── Stage 1: fetch document ──────────────────────────────────────────
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!doc) {
      throw new Error(`Document ${documentId} not found`);
    }

    if (!doc.rawText) {
      throw new Error(`Document ${documentId} has no rawText to ingest`);
    }

    // ── Stage 2: parse / section ─────────────────────────────────────────
    await prisma.ingestJob.updateMany({
      where: { documentId },
      data: { stage: "parse" },
    });

    const sections = splitSections(doc.rawText);
    const summaryText = buildSummary(doc.rawText);

    // ── Stage 3: persist incident + sections ─────────────────────────────
    await prisma.ingestJob.updateMany({
      where: { documentId },
      data: { stage: "persist" },
    });

    const incident = await prisma.incident.create({
      data: {
        documentId: doc.id,
        title: `Incident from doc ${doc.id.slice(0, 8)}`,
        summaryText,
        sections: {
          create: sections,
        },
      },
      include: { sections: true },
    });

    // ── Stage 4: mark document done ───────────────────────────────────────
    await prisma.document.update({
      where: { id: documentId },
      data: { parseStatus: "done" },
    });

    // ── Stage 5: mark job success ─────────────────────────────────────────
    await prisma.ingestJob.updateMany({
      where: { documentId },
      data: {
        status: "success",
        stage: "done",
        finishedAt: new Date(),
        error: null,
      },
    });

    return { incident, jobStatus: "success", error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Always record failure — best-effort, don't throw
    try {
      await prisma.ingestJob.updateMany({
        where: { documentId },
        data: {
          status: "failed",
          error: message,
          finishedAt: new Date(),
        },
      });
      await prisma.document.updateMany({
        where: { id: documentId },
        data: { parseStatus: "failed" },
      });
    } catch (_) {
      // swallow secondary errors
    }

    return { incident: null, jobStatus: "failed", error: message };
  }
}
