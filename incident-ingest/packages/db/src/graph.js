/**
 * API-side graph indexing helper — Sprint 3
 *
 * Thin wrapper around the same graph upsert logic used by the worker.
 * Lives in apps/api/src/lib/ so the manual ingest route can import it
 * without reaching into the worker package.
 *
 * safeIndexIncidentGraph follows the same contract as safeIndexIncidentEmbeddings:
 *   - NEVER throws
 *   - Returns true on success or no-op, false on any error
 *   - Logs a warning on failure; does NOT propagate the error to the caller
 */

import { extractGraph, embedText, cosineSimilarity } from "@pkg/nlp";

// W6-030 — entity canonicalization: merge a near-duplicate node name ("PaymentService")
// into an existing node of the same type ("payment-api") instead of creating a
// second row, when their embeddings are within this cosine distance.
const CANONICALIZATION_DISTANCE_THRESHOLD = 0.12;

/**
 * Map each new node name to the name of an existing same-type node it should
 * merge into, when one is close enough by embedding distance. Exact matches
 * need no embedding call. Names with no close match are left unmapped (they
 * insert as new nodes).
 *
 * @param {import('@prisma/client').PrismaClient} client
 * @param {Array<{ node_type: string, name: string }>} nodes
 * @returns {Promise<Map<string, string>>} original name -> canonical existing name
 */
async function canonicalizeNodeNames(client, nodes) {
  const canonicalNames = new Map();
  const namesByType = new Map();
  for (const node of nodes) {
    if (!namesByType.has(node.node_type)) namesByType.set(node.node_type, new Set());
    namesByType.get(node.node_type).add(node.name);
  }

  for (const [nodeType, names] of namesByType) {
    const existing = await client.$queryRawUnsafe(
      `SELECT "name" FROM "graph_nodes" WHERE "node_type" = $1`,
      nodeType
    );
    if (existing.length === 0) continue;

    const existingNames = existing.map((row) => row.name).filter((name) => !names.has(name));
    if (existingNames.length === 0) continue;

    const existingEmbeddings = await Promise.all(
      existingNames.map(async (name) => ({ name, embedding: await embedText(name) }))
    );

    for (const name of names) {
      const candidateEmbedding = await embedText(name);
      let best = null;
      for (const ref of existingEmbeddings) {
        const distance = 1 - cosineSimilarity(candidateEmbedding, ref.embedding);
        if (distance <= CANONICALIZATION_DISTANCE_THRESHOLD && (!best || distance < best.distance)) {
          best = { name: ref.name, distance };
        }
      }
      if (best) canonicalNames.set(name, best.name);
    }
  }

  return canonicalNames;
}

/**
 * Extract graph entities from an incident's sections and upsert to Postgres.
 *
 * @param {import('@prisma/client').PrismaClient} client
 * @param {{
 *   id: string,
 *   title?: string,
 *   company?: string,
 *   tags?: string[],
 *   sections: Array<{ id: string, type: string, text: string }>
 * }} incident
 * @returns {Promise<boolean>}
 */
export async function safeIndexIncidentGraph(client, incident) {
  try {
    if (!incident?.id) {
      console.warn("[graph] safeIndexIncidentGraph: missing incident.id, skipping");
      return false;
    }

    const sections = incident.sections ?? [];
    if (sections.length === 0) return true;

    const incidentMeta = {
      title: incident.title,
      company: incident.company,
      tags: incident.tags ?? [],
    };

    const { nodes, edges } = await extractGraph(sections, incidentMeta);

    if (nodes.length === 0 && edges.length === 0) return true;

    const canonicalNames = await canonicalizeNodeNames(client, nodes);
    const canonicalize = (name) => canonicalNames.get(name) ?? name;

    // Upsert nodes — ON CONFLICT DO NOTHING for deduplication. Canonicalized
    // names resolve to an existing row, so this is a no-op for those.
    for (const node of nodes) {
      await client.$executeRawUnsafe(
        `INSERT INTO "graph_nodes" ("node_type", "name")
         VALUES ($1, $2)
         ON CONFLICT ("node_type", "name") DO NOTHING`,
        node.node_type,
        canonicalize(node.name)
      );
    }

    // Resolve node IDs and insert edges
    for (const edge of edges) {
      const fromName = canonicalize(edge.from_name);
      const toName = canonicalize(edge.to_name);
      const fromType = nodes.find((n) => n.name === edge.from_name)?.node_type ?? "service";
      const toType = nodes.find((n) => n.name === edge.to_name)?.node_type ?? "service";

      const fromRows = await client.$queryRawUnsafe(
        `SELECT "id" FROM "graph_nodes" WHERE "node_type" = $1 AND "name" = $2 LIMIT 1`,
        fromType,
        fromName
      );
      const toRows = await client.$queryRawUnsafe(
        `SELECT "id" FROM "graph_nodes" WHERE "node_type" = $1 AND "name" = $2 LIMIT 1`,
        toType,
        toName
      );

      if (!fromRows.length || !toRows.length) {
        console.warn(`[graph] Could not resolve node IDs for edge ${fromName} → ${toName}, skipping`);
        continue;
      }

      await client.$executeRawUnsafe(
        `INSERT INTO "graph_edges"
           ("from_node_id", "to_node_id", "rel_type", "incident_id", "evidence_section_id")
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid)`,
        fromRows[0].id,
        toRows[0].id,
        edge.rel_type,
        incident.id,
        edge.evidence_section_id
      );
    }

    console.log(
      `[graph] Indexed ${nodes.length} node(s) and ${edges.length} edge(s) for incident ${incident.id}`
    );
    return true;
  } catch (error) {
    console.warn(
      `[graph] safeIndexIncidentGraph skipped for incidentId=${incident?.id}:`,
      error?.message ?? error
    );
    return false;
  }
}
