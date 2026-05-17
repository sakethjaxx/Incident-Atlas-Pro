#!/usr/bin/env node
/**
 * Graph backfill — Sprint 3
 *
 * Finds all incidents that have sections but NO graph edges yet,
 * and runs extractGraph + upsert for each one.
 *
 * Uses the same keyset pagination pattern as reindex.js so the run is:
 *   - Safe to interrupt and resume (already-extracted incidents are skipped)
 *   - Non-destructive on existing graph rows
 *
 * Usage (from incident-ingest/):
 *   node apps/worker/src/graphBackfill.js [--batch 20] [--dry-run]
 *
 * Options:
 *   --batch N    How many incidents to process per page (default: 20)
 *   --dry-run    Log what would be extracted but don't write anything
 *
 * Skip condition:
 *   An incident is considered already-extracted if it has at least one graph_edge
 *   with incident_id = incident.id. (Nodes may be shared — edges are incident-specific.)
 *
 * Exit codes:
 *   0  Success (all records processed or nothing to do)
 *   1  Fatal error (DB unreachable, bad env, etc.)
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { extractGraph } from "@pkg/nlp";

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const batchArg = args.indexOf("--batch");
const BATCH_SIZE = batchArg !== -1 ? Number(args[batchArg + 1]) || 20 : 20;
const DRY_RUN = args.includes("--dry-run");

// ── DB ────────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient({ log: ["error"] });

// ── Core upsert logic (same as graph.js, standalone for the backfill binary) ──

async function upsertGraphForIncident(incident) {
  const sections = incident.sections ?? [];
  if (sections.length === 0) {
    return { nodes: 0, edges: 0, skipped: true };
  }

  const incidentMeta = {
    title: incident.title,
    company: incident.company,
    tags: incident.tags ?? [],
  };

  const { nodes, edges } = await extractGraph(sections, incidentMeta);

  if (nodes.length === 0 && edges.length === 0) {
    return { nodes: 0, edges: 0, skipped: false };
  }

  if (DRY_RUN) {
    console.log(
      `  [dry-run] incident ${incident.id}: would upsert ${nodes.length} node(s), ${edges.length} edge(s)`
    );
    nodes.forEach((n) => console.log(`    node: [${n.node_type}] ${n.name}`));
    edges.forEach((e) =>
      console.log(`    edge: ${e.from_name} -[${e.rel_type}]-> ${e.to_name} (sec: ${e.evidence_section_id})`)
    );
    return { nodes: nodes.length, edges: edges.length, skipped: false };
  }

  // Upsert nodes
  for (const node of nodes) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "graph_nodes" ("node_type", "name")
       VALUES ($1, $2)
       ON CONFLICT ("node_type", "name") DO NOTHING`,
      node.node_type,
      node.name
    );
  }

  // Resolve IDs and insert edges
  let edgesWritten = 0;
  for (const edge of edges) {
    const fromType = nodes.find((n) => n.name === edge.from_name)?.node_type ?? "service";
    const toType = nodes.find((n) => n.name === edge.to_name)?.node_type ?? "service";

    const fromRows = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "graph_nodes" WHERE "node_type" = $1 AND "name" = $2 LIMIT 1`,
      fromType,
      edge.from_name
    );
    const toRows = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "graph_nodes" WHERE "node_type" = $1 AND "name" = $2 LIMIT 1`,
      toType,
      edge.to_name
    );

    if (!fromRows.length || !toRows.length) {
      console.warn(
        `  [backfill] Could not resolve node IDs for ${edge.from_name} → ${edge.to_name}, skipping edge`
      );
      continue;
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO "graph_edges"
         ("from_node_id", "to_node_id", "rel_type", "incident_id", "evidence_section_id")
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid)`,
      fromRows[0].id,
      toRows[0].id,
      edge.rel_type,
      incident.id,
      edge.evidence_section_id
    );
    edgesWritten++;
  }

  return { nodes: nodes.length, edges: edgesWritten, skipped: false };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `[graphBackfill] Starting — batch=${BATCH_SIZE}, dry-run=${DRY_RUN}`
  );

  // Count incidents with sections but no graph edges yet
  const countRows = await prisma.$queryRaw`
    SELECT count(distinct i.id)::int AS n
    FROM "incidents" i
    JOIN "sections" s ON s."incident_id" = i."id"
    LEFT JOIN "graph_edges" ge ON ge."incident_id" = i."id"
    WHERE ge."id" IS NULL
  `;
  const total = Number(countRows[0]?.n ?? 0);
  console.log(`[graphBackfill] Found ${total} incident(s) with no graph edges`);

  if (total === 0) {
    console.log("[graphBackfill] Nothing to do — all incidents already have graph data or no sections.");
    await prisma.$disconnect();
    process.exit(0);
  }

  let cursor = null; // last processed id for keyset pagination
  let processed = 0;
  let totalNodes = 0;
  let totalEdges = 0;
  let totalSkipped = 0;

  while (true) {
    // Keyset: incidents with sections but no edges, ordered by id
    const batch = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT i.id
      FROM "incidents" i
      JOIN "sections" s ON s."incident_id" = i."id"
      LEFT JOIN "graph_edges" ge ON ge."incident_id" = i."id"
      WHERE ge."id" IS NULL
        ${cursor ? `AND i.id > '${cursor}'` : ""}
      ORDER BY i.id
      LIMIT ${BATCH_SIZE}
    `);

    if (batch.length === 0) break;

    const ids = batch.map((row) => row.id);

    // Load full incident data for this batch
    const incidents = await prisma.incident.findMany({
      where: { id: { in: ids } },
      include: { sections: { orderBy: { createdAt: "asc" } } },
      orderBy: { id: "asc" },
    });

    console.log(
      `[graphBackfill] Processing batch of ${incidents.length} incidents (${processed} done so far)...`
    );

    for (const incident of incidents) {
      try {
        const { nodes, edges, skipped } = await upsertGraphForIncident(incident);
        totalNodes += nodes;
        totalEdges += edges;
        if (skipped) totalSkipped++;
        processed++;
        cursor = incident.id;
        console.log(
          `  incident ${incident.id}: +${nodes} node(s), +${edges} edge(s)${skipped ? " [no sections, skipped]" : ""}`
        );
      } catch (err) {
        console.error(
          `[graphBackfill] Error processing incident ${incident.id}:`,
          err?.message ?? err
        );
        // Continue — don't abort the whole run
        cursor = incident.id;
        processed++;
      }
    }
  }

  console.log(
    `[graphBackfill] Done. incidents=${processed}, nodes=${totalNodes}, edges=${totalEdges}, skipped=${totalSkipped}`
  );

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("[graphBackfill] Fatal:", err?.message ?? err);
  prisma.$disconnect().catch(() => {});
  process.exit(1);
});
