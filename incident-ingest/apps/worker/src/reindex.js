#!/usr/bin/env node
/**
 * Backfill / reindex embeddings for incidents and sections.
 *
 * Finds all incidents (or sections) where the embedding IS NULL and writes
 * deterministic embeddings using the same @pkg/nlp createEmbedding function
 * used during live ingest.
 *
 * Usage (from incident-ingest/):
 *   node apps/worker/src/reindex.js [--batch 50] [--dry-run]
 *
 * Options:
 *   --batch N    How many incidents to process per page (default: 50)
 *   --dry-run    Log what would be indexed but don't write anything
 *   --incidents-only  Skip section embeddings
 *
 * Safe to interrupt and resume — already-indexed records (embedding IS NOT NULL)
 * are skipped automatically.
 *
 * Exit codes:
 *   0  Success (all records indexed or nothing to do)
 *   1  Fatal error (DB unreachable, bad env, etc.)
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  createEmbedding,
  formatEmbeddingForSql,
} from "@pkg/nlp";

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const batchArg = args.indexOf("--batch");
const BATCH_SIZE = batchArg !== -1 ? Number(args[batchArg + 1]) || 50 : 50;
const DRY_RUN = args.includes("--dry-run");
const INCIDENTS_ONLY = args.includes("--incidents-only");

// ── DB ────────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient({
  log: ["error"],
});

// ── Embedding text builders (mirrors retrieval.js) ────────────────────────────

function buildIncidentEmbeddingText(incident) {
  return [
    incident.title,
    incident.company,
    incident.severity,
    ...(incident.tags ?? []),
    ...(incident.products ?? []),
    incident.summaryText,
    ...(incident.sections ?? []).map((s) => `${s.type} ${s.text}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSectionEmbeddingText(section) {
  return `${section.type}\n${section.text}`;
}

// ── Core reindex logic ────────────────────────────────────────────────────────

/**
 * Index embeddings for a single incident and its sections.
 * Returns { incidentIndexed, sectionsIndexed, skipped }.
 */
async function indexIncident(incident) {
  let incidentIndexed = 0;
  let sectionsIndexed = 0;
  let skipped = 0;

  // ── Incident embedding ────────────────────────────────────────────────────
  const incidentVector = formatEmbeddingForSql(
    createEmbedding(buildIncidentEmbeddingText(incident))
  );

  if (incidentVector) {
    if (DRY_RUN) {
      console.log(`  [dry-run] would write incident embedding for ${incident.id}`);
    } else {
      await prisma.$executeRawUnsafe(
        'UPDATE "incidents" SET "summary_embedding" = $1::vector WHERE "id" = $2::uuid',
        incidentVector,
        incident.id
      );
    }
    incidentIndexed = 1;
  } else {
    console.warn(`  [skip] no embedding generated for incident ${incident.id} (empty text?)`);
    skipped = 1;
  }

  // ── Section embeddings ────────────────────────────────────────────────────
  if (!INCIDENTS_ONLY) {
    for (const section of incident.sections ?? []) {
      const sectionVector = formatEmbeddingForSql(
        createEmbedding(buildSectionEmbeddingText(section))
      );
      if (!sectionVector) {
        console.warn(`  [skip] no embedding for section ${section.id}`);
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [dry-run] would write section embedding for ${section.id}`);
      } else {
        await prisma.$executeRawUnsafe(
          'UPDATE "sections" SET "embedding" = $1::vector WHERE "id" = $2::uuid',
          sectionVector,
          section.id
        );
      }
      sectionsIndexed++;
    }
  }

  return { incidentIndexed, sectionsIndexed, skipped };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `[reindex] Starting backfill — batch=${BATCH_SIZE}, dry-run=${DRY_RUN}, incidents-only=${INCIDENTS_ONLY}`
  );

  // Count unindexed incidents
  const totalUnindexed = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM incidents WHERE "summary_embedding" IS NULL
  `;
  const total = Number(totalUnindexed[0].n);
  console.log(`[reindex] Found ${total} incident(s) with no summary_embedding`);

  if (total === 0) {
    console.log("[reindex] Nothing to do — all incidents already indexed.");
    await prisma.$disconnect();
    process.exit(0);
  }

  let cursor = null; // last processed id for keyset pagination
  let processed = 0;
  let totalIncidentIndexed = 0;
  let totalSectionsIndexed = 0;
  let totalSkipped = 0;

  while (true) {
    // Keyset pagination by id so inserts during the run don't cause gaps
    const batch = await prisma.incident.findMany({
      where: {
        summaryEmbedding: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      include: { sections: { orderBy: { createdAt: "asc" } } },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });

    if (batch.length === 0) break;

    console.log(
      `[reindex] Processing batch of ${batch.length} incidents (${processed} done so far)...`
    );

    for (const incident of batch) {
      try {
        const { incidentIndexed, sectionsIndexed, skipped } = await indexIncident(incident);
        totalIncidentIndexed += incidentIndexed;
        totalSectionsIndexed += sectionsIndexed;
        totalSkipped += skipped;
        processed++;
        cursor = incident.id;
      } catch (err) {
        console.error(
          `[reindex] Error indexing incident ${incident.id}:`,
          err?.message ?? err
        );
        // Continue with the rest of the batch — don't abort the whole run
        cursor = incident.id;
        processed++;
      }
    }
  }

  console.log(
    `[reindex] Done. incidents=${totalIncidentIndexed}, sections=${totalSectionsIndexed}, skipped=${totalSkipped}`
  );

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("[reindex] Fatal:", err?.message ?? err);
  prisma.$disconnect().catch(() => {});
  process.exit(1);
});
