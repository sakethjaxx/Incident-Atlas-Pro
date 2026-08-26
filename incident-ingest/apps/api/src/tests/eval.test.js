/**
 * W4-001 - Integration and unit tests for the Sprint 4 eval harness.
 *
 * Covers:
 *   - metric helpers
 *   - POST /eval/queries storage
 *   - POST /eval/run retrieval + graph report
 *   - GET /eval/latest
 *   - malformed input and threshold failure behavior
 */
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../app.js";
import {
  calculateMrr,
  calculateNdcgAtK,
  calculateRecallAtK,
} from "../lib/eval.js";
import { prisma } from "../lib/prisma.js";

const app = buildApp();
const AUTH = { Authorization: "Bearer dev-secret" };
const artifactRoot = path.resolve(process.cwd(), ".tmp-eval-test");

beforeAll(() => {
  process.env.EVAL_ARTIFACT_ROOT = artifactRoot;
});

beforeEach(async () => {
  await cleanupAll();
});

afterAll(async () => {
  await cleanupAll();
  await rm(artifactRoot, { recursive: true, force: true });
  await prisma.$disconnect();
});

async function cleanupAll() {
  await prisma.$executeRaw`DELETE FROM "audit_logs"`;
  await prisma.$executeRaw`DELETE FROM "eval_runs"`;
  await prisma.$executeRaw`DELETE FROM "qa_queries"`;
  await prisma.$executeRaw`DELETE FROM "graph_edges"`;
  await prisma.$executeRaw`DELETE FROM "incidents"`;
  await prisma.$executeRaw`DELETE FROM "graph_nodes"`;
}

async function seedIncident(overrides = {}) {
  return prisma.incident.create({
    data: {
      title: overrides.title ?? "Payment API Pool Exhaustion",
      company: overrides.company ?? "Acme",
      severity: overrides.severity ?? "SEV-1",
      tags: overrides.tags ?? ["payments", "database"],
      date: new Date("2026-05-01T00:00:00Z"),
      summaryText:
        overrides.summaryText ??
        "Payment API errors were caused by database pool exhaustion.",
      sections: {
        create: [
          {
            type: "impact",
            text:
              overrides.impactText ??
              "Payment API returned errors for checkout traffic.",
          },
          {
            type: "rootcause",
            text:
              overrides.rootcauseText ??
              "The root cause was database connection pool exhaustion in payment-api.",
          },
          {
            type: "fix",
            text:
              overrides.fixText ??
              "Engineers increased pool limits and rolled back noisy workers.",
          },
        ],
      },
    },
    include: { sections: true },
  });
}

async function seedGraph(incident) {
  const service = await prisma.graphNode.create({
    data: { nodeType: "service", name: "payment-api" },
  });
  const rootCause = await prisma.graphNode.create({
    data: { nodeType: "root_cause", name: "database pool exhaustion" },
  });
  await prisma.graphEdge.create({
    data: {
      fromNodeId: service.id,
      toNodeId: rootCause.id,
      relType: "CAUSED_BY",
      incidentId: incident.id,
      evidenceSectionId: incident.sections.find((section) => section.type === "rootcause").id,
    },
  });
  return { service, rootCause };
}

function queryPayload(incident, graph = {}) {
  return {
    querySetVersion: "w4-eval-test-v1",
    queries: [
      {
        id: "payment-api-rootcause",
        question: "payment-api database pool root cause",
        expectedIncidentIds: [incident.id],
        expectedSectionIds: [
          incident.sections.find((section) => section.type === "rootcause").id,
        ],
        expectedGraphNodeIds: [graph.service?.id, graph.rootCause?.id].filter(Boolean),
        queryType: graph.service ? "mixed" : "search",
        critical: true,
        tags: ["rootcause", "payments"],
        metadata: { fixture: "w4-001" },
      },
    ],
  };
}

describe("eval metric helpers", () => {
  it("computes Recall@K, MRR, and NDCG deterministically", () => {
    expect(calculateRecallAtK(["i1", "i2"], ["i3", "i1"], 2)).toBe(0.5);
    expect(calculateMrr(["i2"], ["i3", "i2", "i1"])).toBe(0.5);
    expect(calculateNdcgAtK(["i1"], ["i3", "i1"], 10)).toBeCloseTo(0.6309, 4);
  });

  it("handles empty expected IDs without throwing", () => {
    expect(calculateRecallAtK([], ["i1"], 5)).toBeNull();
    expect(calculateMrr([], ["i1"])).toBeNull();
    expect(calculateNdcgAtK([], ["i1"], 10)).toBeNull();
  });
});
describe("POST /eval/queries", () => {
  it("creates a seedable eval query set", async () => {
    const incident = await seedIncident();

    const res = await request(app)
      .post("/eval/queries")
      .set(AUTH)
      .send(queryPayload(incident));

    expect(res.status).toBe(200);
    expect(res.body.querySetVersion).toBe("w4-eval-test-v1");
    expect(res.body.imported).toBe(1);
    expect(res.body.updated).toBe(0);
    expect(res.body.queries[0]).toMatchObject({
      id: "payment-api-rootcause",
      queryType: "search",
      critical: true,
    });

    const stored = await prisma.qaQuery.findUnique({
      where: { id: "payment-api-rootcause" },
    });
    expect(stored.question).toBe("payment-api database pool root cause");
    expect(stored.expectedIncidentIds).toEqual([incident.id]);
  });

  it("returns 400 for malformed query input", async () => {
    const res = await request(app)
      .post("/eval/queries")
      .set(AUTH)
      .send({
        querySetVersion: "bad-v1",
        queries: [
          {
            id: "bad-query",
            question: "broken",
            expectedIncidentIds: ["not-a-uuid"],
            queryType: "search",
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/UUID/i);
  });
});

describe("POST /eval/run and GET /eval/latest", () => {
  it("runs retrieval and graph evals, writes an artifact, and returns latest report", async () => {
    const incident = await seedIncident();
    const graph = await seedGraph(incident);
    await request(app).post("/eval/queries").set(AUTH).send(queryPayload(incident, graph));

    const run = await request(app)
      .post("/eval/run")
      .set(AUTH)
      .send({
        querySetVersion: "w4-eval-test-v1",
        mode: "fixture",
        includeGraph: true,
        includeQa: false,
        thresholds: {
          criticalRecallAt5: 1.0,
          requireEvidenceEdgeCoverage: 1.0,
        },
      });

    expect(run.status).toBe(201);
    expect(run.body.status).toBe("passed");
    expect(run.body.metrics.recallAt5).toBe(1);
    expect(run.body.metrics.recallAt10).toBe(1);
    expect(run.body.metrics.mrr).toBe(1);
    expect(run.body.metrics.graphEvidenceRecallAt5).toBe(1);
    expect(run.body.metrics.evidenceEdgeCoverage).toBe(1);
    expect(run.body.metrics.qaCitationPrecision).toBeNull();
    expect(run.body.failures).toEqual([]);

    await expect(access(path.join(artifactRoot, run.body.artifactPath))).resolves.toBeUndefined();

    const latest = await request(app).get("/eval/latest");
    expect(latest.status).toBe(200);
    expect(latest.body.runId).toBe(run.body.runId);
    expect(latest.body.artifactPath).toBe(run.body.artifactPath);
    expect(latest.body.retrievalConfig.searchLimit).toBe(10);
  });

  it("returns failed status when a critical expected incident misses Recall@5", async () => {
    const missingExpectedIncidentId = "00000000-0000-0000-0000-000000000001";
    await seedIncident({
      title: "Redis Cache Miss Storm",
      summaryText: "A cache outage used only to produce a non-matching result.",
    });
    await request(app)
      .post("/eval/queries")
      .set(AUTH)
      .send({
        querySetVersion: "w4-regression-test-v1",
        queries: [
          {
            id: "critical-miss",
            question: "xyzzy nonexistent checkout phrase",
            expectedIncidentIds: [missingExpectedIncidentId],
            queryType: "search",
            critical: true,
          },
        ],
      });

    const run = await request(app)
      .post("/eval/run")
      .set(AUTH)
      .send({
        querySetVersion: "w4-regression-test-v1",
        mode: "fixture",
        thresholds: { criticalRecallAt5: 1.0 },
      });

    expect(run.status).toBe(201);
    expect(run.body.status).toBe("failed");
    expect(run.body.metrics.criticalMissCount).toBe(1);
    expect(run.body.failures[0]).toMatchObject({
      type: "critical_recall_at_5",
      queryId: "critical-miss",
    });
  });

  it("returns 400 for malformed eval run input", async () => {
    const res = await request(app)
      .post("/eval/run")
      .set(AUTH)
      .send({
        querySetVersion: "missing-v1",
        mode: "banana",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mode/);
  });

  it("returns 404 when no latest eval report exists", async () => {
    const latest = await request(app).get("/eval/latest");
    expect(latest.status).toBe(404);
    expect(latest.body.error).toMatch(/No eval run/);
  });
});

describe("Eval Auth & Rate Limits", () => {
  let originalAdminToken;
  let originalReadTokenRequired;

  beforeAll(() => {
    originalAdminToken = process.env.ADMIN_TOKEN;
    originalReadTokenRequired = process.env.READ_TOKEN_REQUIRED;
    process.env.ADMIN_TOKEN = "eval-admin-token";
    process.env.READ_TOKEN_REQUIRED = "true";
  });

  afterAll(() => {
    process.env.ADMIN_TOKEN = originalAdminToken;
    process.env.READ_TOKEN_REQUIRED = originalReadTokenRequired;
  });

  it("POST /eval/queries returns 401 without auth", async () => {
    const res = await request(app).post("/eval/queries").send({ querySetVersion: "test" });
    expect(res.status).toBe(401);
  });

  it("POST /eval/run returns 401 without auth", async () => {
    const res = await request(app).post("/eval/run").send({ querySetVersion: "test" });
    expect(res.status).toBe(401);
  });

  it("GET /eval/latest returns 401 without auth when READ_TOKEN_REQUIRED=true", async () => {
    const res = await request(app).get("/eval/latest");
    expect(res.status).toBe(401);
  });

  it("POST /eval/queries returns 429 when rate limit exceeded", async () => {
    // Limit is 5
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/eval/queries")
        .set({ Authorization: "Bearer eval-admin-token" })
        .send({ querySetVersion: `test-${i}`, queries: [] });
    }
    const res = await request(app)
      .post("/eval/queries")
      .set({ Authorization: "Bearer eval-admin-token" })
      .send({ querySetVersion: "test-6", queries: [] });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Rate limit exceeded");
  });
});
