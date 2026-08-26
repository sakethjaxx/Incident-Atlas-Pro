import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRead } from "../middleware/auth.js";
import { publicReadLimiter } from "../middleware/rateLimit.js";


export const graphRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === "string" && UUID_RE.test(v); }

const PAGE_SIZE = 20;
const MAX_DEPTH = 2;

/**
 * GET /graph/patterns?service=...&symptom=...&page=1
 *
 * Returns recurring node clusters (patterns) across incidents.
 * Each anchor node matching the filter produces one pattern containing its
 * direct neighbors and the count of incidents sharing edges with that anchor.
 *
 * Response (frozen API_SPEC contract):
 *   {
 *     patterns: [{ incidentCount: <int>, nodes: [{ id, name, type }] }],
 *     page: <int>,
 *     hasMore: <bool>
 *   }
 *
 * Errors:
 *   400  Filter param provided but empty
 */
graphRouter.get("/graph/patterns", requireRead, publicReadLimiter, async (req, res, next) => {

  try {
    const { service, symptom, page: pageStr } = req.query;

    if (service !== undefined && (typeof service !== "string" || !service.trim())) {
      return res.status(400).json({ error: "service filter must be a non-empty string" });
    }
    if (symptom !== undefined && (typeof symptom !== "string" || !symptom.trim())) {
      return res.status(400).json({ error: "symptom filter must be a non-empty string" });
    }

    const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    // Build WHERE clause for anchor-node filter
    const conditions = [];
    const params = [];

    if (service?.trim()) {
      params.push(`%${service.trim()}%`);
      conditions.push(`(node_type = 'service' AND name ILIKE $${params.length})`);
    }
    if (symptom?.trim()) {
      params.push(`%${symptom.trim()}%`);
      conditions.push(`(node_type = 'symptom' AND name ILIKE $${params.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" OR ")}` : "";

    // Fetch one extra row to determine hasMore
    params.push(PAGE_SIZE + 1);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const anchorNodes = await prisma.$queryRawUnsafe(
      `SELECT id::text, node_type, name FROM graph_nodes
       ${whereClause}
       ORDER BY name
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      ...params
    );

    const hasMore = anchorNodes.length > PAGE_SIZE;
    const pageNodes = hasMore ? anchorNodes.slice(0, PAGE_SIZE) : anchorNodes;

    // For each anchor: get connected nodes + distinct incident count
    const patterns = await Promise.all(
      pageNodes.map(async (anchor) => {
        const [neighborRows, incidentRows] = await Promise.all([
          prisma.$queryRawUnsafe(
            `SELECT DISTINCT gn.id::text, gn.node_type, gn.name
             FROM graph_edges ge
             JOIN graph_nodes gn ON (
               (ge.from_node_id = $1::uuid AND ge.to_node_id = gn.id)
               OR (ge.to_node_id = $1::uuid AND ge.from_node_id = gn.id)
             )`,
            anchor.id
          ),
          prisma.$queryRawUnsafe(
            `SELECT COUNT(DISTINCT incident_id)::int AS n
             FROM graph_edges
             WHERE from_node_id = $1::uuid OR to_node_id = $1::uuid`,
            anchor.id
          ),
        ]);

        const incidentCount = Number(incidentRows[0]?.n ?? 0);
        const nodes = [
          { id: anchor.id, name: anchor.name, type: anchor.node_type },
          ...neighborRows.map((r) => ({ id: r.id, name: r.name, type: r.node_type })),
        ];

        return { incidentCount, nodes };
      })
    );

    return res.json({ patterns, page, hasMore });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /graph/neighbors?node_id=...&depth=1
 *
 * Returns adjacent nodes and connecting edges via BFS traversal.
 * Depth hard-capped at MAX_DEPTH (2).
 * Root node is always included in nodes[].
 * Every edge in the response includes evidence_section_id.
 *
 * Response (frozen API_SPEC contract):
 *   {
 *     nodes: [{ id, name, type }],
 *     edges: [{ id, from, to, type, evidence_section_id }]
 *   }
 *
 * Errors:
 *   400  node_id missing / not a UUID / depth > 2
 *   404  Node not found
 */
graphRouter.get("/graph/neighbors", requireRead, publicReadLimiter, async (req, res, next) => {

  try {
    const { node_id, depth: depthStr } = req.query;

    if (!node_id) {
      return res.status(400).json({ error: "node_id is required" });
    }
    if (!isUuid(node_id)) {
      return res.status(400).json({ error: "node_id must be a valid UUID" });
    }

    const depth = depthStr !== undefined ? parseInt(depthStr, 10) : 1;
    if (isNaN(depth) || depth < 1) {
      return res.status(400).json({ error: "depth must be a positive integer" });
    }
    if (depth > MAX_DEPTH) {
      return res.status(400).json({ error: `depth must not exceed ${MAX_DEPTH}` });
    }

    // Verify root node exists
    const rootRows = await prisma.$queryRawUnsafe(
      `SELECT id::text, node_type, name FROM graph_nodes WHERE id = $1::uuid LIMIT 1`,
      node_id
    );
    if (rootRows.length === 0) {
      return res.status(404).json({ error: "Node not found" });
    }
    const root = rootRows[0];

    // BFS traversal — frontier holds node IDs discovered at the previous depth level
    const visitedNodeIds = new Set([root.id]);
    const allNodes = [{ id: root.id, name: root.name, type: root.node_type }];
    const allEdges = [];
    const visitedEdgeIds = new Set();
    let frontier = [root.id];

    for (let d = 0; d < depth; d++) {
      if (frontier.length === 0) break;

      // $1..$N are reused in both IN clauses — valid in PostgreSQL
      const placeholders = frontier.map((_, i) => `$${i + 1}::uuid`).join(", ");

      const edgeRows = await prisma.$queryRawUnsafe(
        `SELECT ge.id::text,
                ge.from_node_id::text AS "from",
                ge.to_node_id::text   AS "to",
                ge.rel_type           AS type,
                ge.evidence_section_id::text AS evidence_section_id,
                fn.id::text AS fn_id, fn.node_type AS fn_type, fn.name AS fn_name,
                tn.id::text AS tn_id, tn.node_type AS tn_type, tn.name AS tn_name
         FROM graph_edges ge
         JOIN graph_nodes fn ON fn.id = ge.from_node_id
         JOIN graph_nodes tn ON tn.id = ge.to_node_id
         WHERE ge.from_node_id IN (${placeholders})
            OR ge.to_node_id   IN (${placeholders})`,
        ...frontier
      );

      const nextFrontier = [];

      for (const edge of edgeRows) {
        if (!visitedEdgeIds.has(edge.id)) {
          visitedEdgeIds.add(edge.id);
          allEdges.push({
            id: edge.id,
            from: edge.from,
            to: edge.to,
            type: edge.type,
            evidence_section_id: edge.evidence_section_id,
          });
        }

        for (const [nid, ntype, nname] of [
          [edge.fn_id, edge.fn_type, edge.fn_name],
          [edge.tn_id, edge.tn_type, edge.tn_name],
        ]) {
          if (!visitedNodeIds.has(nid)) {
            visitedNodeIds.add(nid);
            allNodes.push({ id: nid, name: nname, type: ntype });
            nextFrontier.push(nid);
          }
        }
      }

      frontier = nextFrontier;
    }

    return res.json({ nodes: allNodes, edges: allEdges });
  } catch (error) {
    return next(error);
  }
});
