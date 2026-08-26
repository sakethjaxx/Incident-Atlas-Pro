/**
 * W3-003 — Integration tests for GET /graph/patterns and GET /graph/neighbors
 *
 * Covers the frozen API_SPEC Sprint 3 contract:
 *   - patterns keyword filter (service / symptom)
 *   - incidentCount reflects distinct incidents
 *   - neighbors depth=1 and depth=2 traversal
 *   - no-results path
 *   - unknown node → 404
 *   - malformed input → 400
 *   - depth cap (> 2 → 400)
 *   - evidence_section_id present on every edge
 *
 * Requires a running Postgres DB with Sprint 3 migrations applied.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = buildApp();

// ── Cleanup ───────────────────────────────────────────────────────────────────

async function cleanupAll() {
  // Order matters: edges first (RESTRICT FKs on nodes + sections), then incidents
  // (cascades sections), then orphaned nodes.
  await prisma.$executeRaw`DELETE FROM "graph_edges"`;
  await prisma.$executeRaw`DELETE FROM "incidents"`;
  await prisma.$executeRaw`DELETE FROM "graph_nodes"`;
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function createIncidentWithSection(title = "Graph API Test Incident") {
  return prisma.incident.create({
    data: {
      title,
      company: "TestCo",
      sections: {
        create: [{ type: "rootcause", text: "Root cause text for graph API test." }],
      },
    },
    include: { sections: true },
  });
}

async function upsertNode(nodeType, name) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO graph_nodes (node_type, name)
     VALUES ($1, $2)
     ON CONFLICT (node_type, name) DO NOTHING`,
    nodeType,
    name
  );
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id::text FROM graph_nodes WHERE node_type = $1 AND name = $2 LIMIT 1`,
    nodeType,
    name
  );
  return rows[0].id;
}

async function insertEdge(fromNodeId, toNodeId, relType, incidentId, evidenceSectionId) {
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO graph_edges
       (from_node_id, to_node_id, rel_type, incident_id, evidence_section_id)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid)
     RETURNING id::text`,
    fromNodeId,
    toNodeId,
    relType,
    incidentId,
    evidenceSectionId
  );
  return rows[0].id;
}

beforeEach(async () => {
  await cleanupAll();
});

afterAll(async () => {
  await cleanupAll();
  await prisma.$disconnect();
});

// ── GET /graph/patterns — keyword filter ──────────────────────────────────────

describe("GET /graph/patterns — keyword filter", () => {
  it("returns matching pattern when filtering by service name substring", async () => {
    const incident = await createIncidentWithSection("Payment API Outage");
    const sectionId = incident.sections[0].id;
    const svcId = await upsertNode("service", "payment-api");
    const symId = await upsertNode("symptom", "high error rate");
    await insertEdge(svcId, symId, "HAS_SYMPTOM", incident.id, sectionId);

    const res = await request(app).get("/graph/patterns?service=payment");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.patterns)).toBe(true);
    expect(res.body.patterns.length).toBeGreaterThan(0);

    const pattern = res.body.patterns[0];
    expect(typeof pattern.incidentCount).toBe("number");
    expect(Array.isArray(pattern.nodes)).toBe(true);
    expect(pattern.nodes.some((n) => n.name === "payment-api")).toBe(true);
  });

  it("returns matching pattern when filtering by symptom name substring", async () => {
    const incident = await createIncidentWithSection("DB Outage");
    const sectionId = incident.sections[0].id;
    const svcId = await upsertNode("service", "db-primary");
    const symId = await upsertNode("symptom", "high cpu usage");
    await insertEdge(svcId, symId, "HAS_SYMPTOM", incident.id, sectionId);

    const res = await request(app).get("/graph/patterns?symptom=cpu");
    expect(res.status).toBe(200);
    expect(
      res.body.patterns.some((p) => p.nodes.some((n) => n.name === "high cpu usage"))
    ).toBe(true);
  });

  it("incidentCount equals the number of distinct incidents sharing the anchor node", async () => {
    const inc1 = await createIncidentWithSection("Incident Alpha");
    const inc2 = await createIncidentWithSection("Incident Beta");
    const svcId = await upsertNode("service", "auth-service");
    const symId = await upsertNode("symptom", "timeout");
    await insertEdge(svcId, symId, "HAS_SYMPTOM", inc1.id, inc1.sections[0].id);
    await insertEdge(svcId, symId, "HAS_SYMPTOM", inc2.id, inc2.sections[0].id);

    const res = await request(app).get("/graph/patterns?service=auth-service");
    expect(res.status).toBe(200);
    const pattern = res.body.patterns.find((p) =>
      p.nodes.some((n) => n.name === "auth-service")
    );
    expect(pattern).toBeDefined();
    expect(pattern.incidentCount).toBe(2);
  });

  it("each pattern node has id, name, type fields", async () => {
    const incident = await createIncidentWithSection("Node Shape Test");
    const sectionId = incident.sections[0].id;
    const svcId = await upsertNode("service", "shape-test-svc");
    const symId = await upsertNode("symptom", "shape-test-sym");
    await insertEdge(svcId, symId, "HAS_SYMPTOM", incident.id, sectionId);

    const res = await request(app).get("/graph/patterns?service=shape-test-svc");
    expect(res.status).toBe(200);
    expect(res.body.patterns.length).toBeGreaterThan(0);
    for (const pattern of res.body.patterns) {
      for (const node of pattern.nodes) {
        expect(typeof node.id).toBe("string");
        expect(typeof node.name).toBe("string");
        expect(typeof node.type).toBe("string");
      }
    }
  });
});

// ── GET /graph/patterns — no-results ─────────────────────────────────────────

describe("GET /graph/patterns — no-results", () => {
  it("returns empty patterns array and pagination fields when no match", async () => {
    const res = await request(app).get(
      "/graph/patterns?service=xyzzy_nonexistent_service_42"
    );
    expect(res.status).toBe(200);
    expect(res.body.patterns).toHaveLength(0);
    expect(typeof res.body.page).toBe("number");
    expect(typeof res.body.hasMore).toBe("boolean");
    expect(res.body.hasMore).toBe(false);
  });
});

// ── GET /graph/patterns — bad input 400 ──────────────────────────────────────

describe("GET /graph/patterns — bad input", () => {
  it("returns 400 when service param is present but empty", async () => {
    const res = await request(app).get("/graph/patterns?service=");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 when symptom param is present but empty", async () => {
    const res = await request(app).get("/graph/patterns?symptom=");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

// ── GET /graph/patterns — pagination ─────────────────────────────────────────

describe("GET /graph/patterns — pagination", () => {
  it("returns page and hasMore fields in response", async () => {
    const res = await request(app).get("/graph/patterns?page=1");
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(typeof res.body.hasMore).toBe("boolean");
  });
});

// ── GET /graph/neighbors — depth=1 ───────────────────────────────────────────

describe("GET /graph/neighbors — depth=1", () => {
  it("returns root node and its adjacent node and edge", async () => {
    const incident = await createIncidentWithSection("Neighbors depth=1 Test");
    const sectionId = incident.sections[0].id;
    const svcId = await upsertNode("service", "api-gateway");
    const symId = await upsertNode("symptom", "502 bad gateway");
    const edgeId = await insertEdge(svcId, symId, "HAS_SYMPTOM", incident.id, sectionId);

    const res = await request(app).get(`/graph/neighbors?node_id=${svcId}&depth=1`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(Array.isArray(res.body.edges)).toBe(true);
    expect(res.body.nodes.some((n) => n.id === svcId)).toBe(true);
    expect(res.body.nodes.some((n) => n.id === symId)).toBe(true);
    expect(res.body.edges.some((e) => e.id === edgeId)).toBe(true);
  });

  it("each node has id, name, type fields", async () => {
    const incident = await createIncidentWithSection("Node Shape neighbors Test");
    const sectionId = incident.sections[0].id;
    const svcId = await upsertNode("service", "neighbor-shape-svc");
    const symId = await upsertNode("symptom", "neighbor-shape-sym");
    await insertEdge(svcId, symId, "HAS_SYMPTOM", incident.id, sectionId);

    const res = await request(app).get(`/graph/neighbors?node_id=${svcId}&depth=1`);
    expect(res.status).toBe(200);
    for (const node of res.body.nodes) {
      expect(typeof node.id).toBe("string");
      expect(typeof node.name).toBe("string");
      expect(typeof node.type).toBe("string");
    }
  });

  it("isolated node (no edges) returns only the root node and empty edges", async () => {
    const svcId = await upsertNode("service", "isolated-node");
    // No edges inserted

    const res = await request(app).get(`/graph/neighbors?node_id=${svcId}&depth=1`);
    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(1);
    expect(res.body.nodes[0].id).toBe(svcId);
    expect(res.body.edges).toHaveLength(0);
  });
});

// ── GET /graph/neighbors — evidence fields on every edge ─────────────────────

describe("GET /graph/neighbors — evidence fields present on every edge", () => {
  it("every edge includes evidence_section_id", async () => {
    const incident = await createIncidentWithSection("Evidence fields test");
    const sectionId = incident.sections[0].id;
    const svcId = await upsertNode("service", "evidence-svc");
    const symId = await upsertNode("symptom", "evidence-sym");
    await insertEdge(svcId, symId, "HAS_SYMPTOM", incident.id, sectionId);

    const res = await request(app).get(`/graph/neighbors?node_id=${svcId}&depth=1`);
    expect(res.status).toBe(200);
    expect(res.body.edges.length).toBeGreaterThan(0);
    for (const edge of res.body.edges) {
      expect(edge.evidence_section_id).toBeTruthy();
      expect(typeof edge.evidence_section_id).toBe("string");
    }
  });

  it("every edge has all required fields: id, from, to, type, evidence_section_id", async () => {
    const incident = await createIncidentWithSection("Edge full shape test");
    const sectionId = incident.sections[0].id;
    const svcId = await upsertNode("service", "edge-full-svc");
    const symId = await upsertNode("symptom", "edge-full-sym");
    const edgeId = await insertEdge(svcId, symId, "HAS_SYMPTOM", incident.id, sectionId);

    const res = await request(app).get(`/graph/neighbors?node_id=${svcId}&depth=1`);
    expect(res.status).toBe(200);
    const edge = res.body.edges.find((e) => e.id === edgeId);
    expect(edge).toBeDefined();
    expect(typeof edge.id).toBe("string");
    expect(typeof edge.from).toBe("string");
    expect(typeof edge.to).toBe("string");
    expect(typeof edge.type).toBe("string");
    expect(typeof edge.evidence_section_id).toBe("string");
    expect(edge.evidence_section_id).toBe(sectionId);
  });
});

// ── GET /graph/neighbors — depth cap ─────────────────────────────────────────

describe("GET /graph/neighbors — depth cap", () => {
  it("returns 400 when depth=3 is requested", async () => {
    const nodeId = "00000000-0000-0000-0000-000000000001";
    const res = await request(app).get(`/graph/neighbors?node_id=${nodeId}&depth=3`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/depth/i);
  });

  it("depth=2 traverses two hops: svc → sym → fix", async () => {
    const incident = await createIncidentWithSection("Depth 2 chain test");
    const sectionId = incident.sections[0].id;
    const svcId = await upsertNode("service", "depth2-svc");
    const symId = await upsertNode("symptom", "depth2-sym");
    const fixId = await upsertNode("fix", "depth2-fix");
    await insertEdge(svcId, symId, "HAS_SYMPTOM", incident.id, sectionId);
    await insertEdge(symId, fixId, "RESOLVED_BY", incident.id, sectionId);

    const res = await request(app).get(`/graph/neighbors?node_id=${svcId}&depth=2`);
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n) => n.id === svcId)).toBe(true);
    expect(res.body.nodes.some((n) => n.id === symId)).toBe(true);
    expect(res.body.nodes.some((n) => n.id === fixId)).toBe(true);
    expect(res.body.edges).toHaveLength(2);
  });

  it("depth=1 does NOT traverse the second hop", async () => {
    const incident = await createIncidentWithSection("Depth 1 boundary test");
    const sectionId = incident.sections[0].id;
    const svcId = await upsertNode("service", "d1bound-svc");
    const symId = await upsertNode("symptom", "d1bound-sym");
    const fixId = await upsertNode("fix", "d1bound-fix");
    await insertEdge(svcId, symId, "HAS_SYMPTOM", incident.id, sectionId);
    await insertEdge(symId, fixId, "RESOLVED_BY", incident.id, sectionId);

    const res = await request(app).get(`/graph/neighbors?node_id=${svcId}&depth=1`);
    expect(res.status).toBe(200);
    // fix node is 2 hops away — must NOT appear at depth=1
    expect(res.body.nodes.some((n) => n.id === fixId)).toBe(false);
  });
});

// ── GET /graph/neighbors — unknown node 404 ───────────────────────────────────

describe("GET /graph/neighbors — unknown node 404", () => {
  it("returns 404 for a valid UUID that does not exist as a node", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000099";
    const res = await request(app).get(`/graph/neighbors?node_id=${unknownId}&depth=1`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

// ── GET /graph/neighbors — malformed input 400 ───────────────────────────────

describe("GET /graph/neighbors — malformed input", () => {
  it("returns 400 when node_id is missing", async () => {
    const res = await request(app).get("/graph/neighbors?depth=1");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/node_id/i);
  });

  it("returns 400 when node_id is not a valid UUID", async () => {
    const res = await request(app).get("/graph/neighbors?node_id=not-a-uuid&depth=1");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uuid/i);
  });

  it("returns 400 when depth=0", async () => {
    const nodeId = "00000000-0000-0000-0000-000000000001";
    const res = await request(app).get(`/graph/neighbors?node_id=${nodeId}&depth=0`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/depth/i);
  });
});
