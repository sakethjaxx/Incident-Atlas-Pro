/**
 * Worker graph indexing — Sprint 3
 *
 * Provides safeIndexIncidentGraph(client, incident) which:
 *   1. Calls extractGraph(sections, incidentMeta) from @pkg/nlp
 *   2. Upserts graph_nodes (UNIQUE node_type + name — deduplicates across incidents)
 *   3. Inserts graph_edges with mandatory evidence_section_id
 *   4. NEVER throws — any error is logged and returns false
 *
 * Failure contract: same as safeIndexIncidentEmbeddings.
 *   Graph extraction failure MUST NOT roll back incident creation.
 *   The function wraps everything in try/catch and returns false on error.
 *
 * Edge upsert strategy:
 *   Nodes use ON CONFLICT DO NOTHING (pure dedup, no overwrite).
 *   Edges are inserted fresh (same entity pair from a new incident = new evidence-backed edge).
 *   This means two incidents sharing the same root_cause → one node, two edges with distinct
 *   evidence_section_ids pointing to each incident's section.
 */

import { extractGraph } from "@pkg/nlp";

/**
 * Safe graph extraction and upsert for a single incident.
 *
 * @param {import('@prisma/client').PrismaClient} client
 * @param {{
 *   id: string,
 *   title?: string,
 *   company?: string,
 *   tags?: string[],
 *   sections: Array<{ id: string, type: string, text: string }>
 * }} incident
 * @returns {Promise<boolean>}  true on success or no-op, false on any error
 */
export async function safeIndexIncidentGraph(client, incident) {
  try {
    if (!incident?.id) {
      console.warn("[graph] safeIndexIncidentGraph: missing incident.id, skipping");
      return false;
    }

    const sections = incident.sections ?? [];
    if (sections.length === 0) {
      // No sections → nothing to extract; not an error
      return true;
    }

    const incidentMeta = {
      title: incident.title,
      company: incident.company,
      tags: incident.tags ?? [],
    };

    const { nodes, edges } = await extractGraph(sections, incidentMeta);

    if (nodes.length === 0 && edges.length === 0) {
      // Rule extractor found nothing — not an error, just sparse data
      return true;
    }

    // ── Upsert nodes ──────────────────────────────────────────────────────────
    // ON CONFLICT DO NOTHING: if the node already exists (from another incident)
    // we keep the original row. This is the deduplication guarantee.
    for (const node of nodes) {
      await client.$executeRawUnsafe(
        `INSERT INTO "graph_nodes" ("node_type", "name")
         VALUES ($1, $2)
         ON CONFLICT ("node_type", "name") DO NOTHING`,
        node.node_type,
        node.name
      );
    }

    // ── Insert edges ──────────────────────────────────────────────────────────
    // For each edge: look up both node IDs, then insert the edge.
    // Edges are evidence-specific — same entity pair from two incidents creates two edges.
    for (const edge of edges) {
      // Resolve from_node_id
      const fromRows = await client.$queryRawUnsafe(
        `SELECT "id" FROM "graph_nodes" WHERE "node_type" = $1 AND "name" = $2 LIMIT 1`,
        // edge.from_name was validated and lowercased by extractGraph
        lookupNodeType(edge.from_name, nodes),
        edge.from_name
      );

      const toRows = await client.$queryRawUnsafe(
        `SELECT "id" FROM "graph_nodes" WHERE "node_type" = $1 AND "name" = $2 LIMIT 1`,
        lookupNodeType(edge.to_name, nodes),
        edge.to_name
      );

      if (!fromRows.length || !toRows.length) {
        console.warn(
          `[graph] Could not resolve node IDs for edge ${edge.from_name} → ${edge.to_name}, skipping`
        );
        continue;
      }

      const fromNodeId = fromRows[0].id;
      const toNodeId = toRows[0].id;

      await client.$executeRawUnsafe(
        `INSERT INTO "graph_edges"
           ("from_node_id", "to_node_id", "rel_type", "incident_id", "evidence_section_id")
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid)`,
        fromNodeId,
        toNodeId,
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

/**
 * Look up the node_type for a given node name within this batch.
 * Falls back to "service" if the name isn't found in the batch nodes list.
 * Used when inserting edges: we need the node_type to do the SELECT lookup.
 *
 * @param {string} name
 * @param {Array<{name: string, node_type: string}>} batchNodes
 * @returns {string}
 */
function lookupNodeType(name, batchNodes) {
  const found = batchNodes.find((n) => n.name === name);
  return found?.node_type ?? "service";
}
