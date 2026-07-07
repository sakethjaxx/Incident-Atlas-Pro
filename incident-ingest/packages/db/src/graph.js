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

import { extractGraph } from "@pkg/nlp";

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

    // Upsert nodes — ON CONFLICT DO NOTHING for deduplication
    for (const node of nodes) {
      await client.$executeRawUnsafe(
        `INSERT INTO "graph_nodes" ("node_type", "name")
         VALUES ($1, $2)
         ON CONFLICT ("node_type", "name") DO NOTHING`,
        node.node_type,
        node.name
      );
    }

    // Resolve node IDs and insert edges
    for (const edge of edges) {
      const fromType = nodes.find((n) => n.name === edge.from_name)?.node_type ?? "service";
      const toType = nodes.find((n) => n.name === edge.to_name)?.node_type ?? "service";

      const fromRows = await client.$queryRawUnsafe(
        `SELECT "id" FROM "graph_nodes" WHERE "node_type" = $1 AND "name" = $2 LIMIT 1`,
        fromType,
        edge.from_name
      );
      const toRows = await client.$queryRawUnsafe(
        `SELECT "id" FROM "graph_nodes" WHERE "node_type" = $1 AND "name" = $2 LIMIT 1`,
        toType,
        edge.to_name
      );

      if (!fromRows.length || !toRows.length) {
        console.warn(`[graph] Could not resolve node IDs for edge ${edge.from_name} → ${edge.to_name}, skipping`);
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
