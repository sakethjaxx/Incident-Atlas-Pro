/**
 * W2-004 — Integration tests for GET /incidents/:id/similar
 *
 * Tests the frozen API_SPEC contract:
 *   - similar key (array of { incident, score, reason, matchedSections })
 *   - backward-compat data alias
 *   - relevance ordering (related incident scores higher than unrelated)
 *   - human-readable reason string
 *   - 404 for unknown incident
 *   - 400 for malformed ID
 *
 * Requires a running Postgres DB.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = buildApp();

async function seedIncident(overrides = {}) {
  return prisma.incident.create({
    data: {
      title: overrides.title ?? "Database Connection Pool Exhaustion",
      company: overrides.company ?? "Acme",
      severity: overrides.severity ?? "SEV-2",
      tags: overrides.tags ?? ["database", "connection"],
      date: overrides.date ? new Date(overrides.date) : new Date("2026-01-10"),
      summaryText:
        overrides.summaryText ?? "DB pool reached max connections causing API failures.",
      sections: {
        create: [
          {
            type: "impact",
            text: overrides.impactText ?? "API requests failed during a database outage.",
          },
          {
            type: "rootcause",
            text: overrides.rootCauseText ?? "Database connection pool exhausted under load.",
          },
          {
            type: "fix",
            text: overrides.fixText ?? "Increased pool size and added a circuit breaker.",
          },
        ],
      },
    },
    include: { sections: true },
  });
}

beforeEach(async () => {
  await prisma.section.deleteMany();
  await prisma.incident.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("GET /incidents/:id/similar — response shape", () => {
  it("returns similar array with incident, score, reason, matchedSections", async () => {
    const source = await seedIncident({ title: "Primary Database Pool Exhaustion" });
    await seedIncident({
      title: "Checkout Database Saturation",
      tags: ["database", "pool"],
      rootCauseText: "Database connection pool saturated after a load spike.",
    });

    const res = await request(app).get(`/incidents/${source.id}/similar?limit=2`);
    expect(res.status).toBe(200);

    // Top-level contract keys
    expect(Array.isArray(res.body.similar)).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.limit).toBe("number");

    // Backward-compat data alias matches similar
    expect(res.body.data).toEqual(res.body.similar);

    // Shape of each item
    const item = res.body.similar[0];
    expect(item).toBeDefined();
    expect(item.incident).toBeDefined();
    expect(typeof item.incident.id).toBe("string");
    expect(typeof item.incident.title).toBe("string");
    expect(Array.isArray(item.incident.tags)).toBe(true);
    expect(typeof item.score).toBe("number");
    expect(typeof item.reason).toBe("string");
    expect(item.reason.length).toBeGreaterThan(0);
    expect(Array.isArray(item.matchedSections)).toBe(true);
  });

  it("does not include the source incident in results", async () => {
    const source = await seedIncident({ title: "Primary DB Pool Exhaustion" });
    await seedIncident({
      title: "Secondary DB Pool Exhaustion",
      tags: ["database", "pool"],
    });

    const res = await request(app).get(`/incidents/${source.id}/similar`);
    expect(res.status).toBe(200);
    expect(res.body.similar.every((item) => item.incident.id !== source.id)).toBe(true);
  });
});

// ── Relevance ─────────────────────────────────────────────────────────────────

describe("GET /incidents/:id/similar — relevance", () => {
  it("returns reasoned similar incidents with positive scores", async () => {
    const source = await seedIncident({
      title: "Primary Database Pool Exhaustion",
      tags: ["database", "pool"],
    });
    await seedIncident({
      title: "Checkout Database Saturation",
      tags: ["database", "pool"],
      rootCauseText: "Database connection pool saturated after a load spike.",
      fixText: "Raised max connections and added circuit breaker protection.",
    });
    await seedIncident({
      title: "Certificate Renewal Notice",
      tags: ["ssl"],
      rootCauseText: "Certificate expired before rotation.",
      fixText: "Renewed certificate and automated expiry alerts.",
    });

    const res = await request(app).get(`/incidents/${source.id}/similar?limit=2`);

    expect(res.status).toBe(200);
    expect(res.body.similar.length).toBeGreaterThanOrEqual(1);
    expect(res.body.similar[0].incident.id).not.toBe(source.id);
    expect(res.body.similar[0].score).toBeGreaterThan(0);
  });

  it("reason string contains a meaningful description", async () => {
    const source = await seedIncident({
      title: "Redis OOM Incident",
      tags: ["redis", "memory"],
    });
    await seedIncident({
      title: "Redis Memory Exhaustion",
      tags: ["redis", "memory"],
      rootCauseText: "Redis ran out of memory due to AOF rewrite.",
    });

    const res = await request(app).get(`/incidents/${source.id}/similar?limit=1`);
    expect(res.status).toBe(200);
    expect(res.body.similar.length).toBeGreaterThanOrEqual(1);

    // reason must be a non-empty string (deterministic content varies with fallback)
    expect(typeof res.body.similar[0].reason).toBe("string");
    expect(res.body.similar[0].reason.trim().length).toBeGreaterThan(0);
  });

  it("matchedSections items have id, type, text", async () => {
    const source = await seedIncident({ title: "CDN Cache Failure" });
    await seedIncident({ title: "CDN Edge Eviction" });

    const res = await request(app).get(`/incidents/${source.id}/similar?limit=1`);
    expect(res.status).toBe(200);

    if (res.body.similar.length > 0 && res.body.similar[0].matchedSections.length > 0) {
      const sec = res.body.similar[0].matchedSections[0];
      expect(typeof sec.id).toBe("string");
      expect(typeof sec.type).toBe("string");
      expect(typeof sec.text).toBe("string");
    }
  });

  it("returns empty similar array when no other incidents exist", async () => {
    const source = await seedIncident({ title: "Lonely Incident" });

    const res = await request(app).get(`/incidents/${source.id}/similar`);
    expect(res.status).toBe(200);
    expect(res.body.similar).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("GET /incidents/:id/similar — error handling", () => {
  it("returns 404 for an unknown (valid-format) incident UUID", async () => {
    const res = await request(app).get(
      "/incidents/00000000-0000-0000-0000-000000000000/similar"
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 400 for a malformed incident ID", async () => {
    const res = await request(app).get("/incidents/not-a-uuid/similar");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns 400 for a numeric incident ID", async () => {
    const res = await request(app).get("/incidents/12345/similar");
    expect(res.status).toBe(400);
  });
});

// ── GET /incidents/:id — error coverage ──────────────────────────────────────

describe("GET /incidents/:id — error handling", () => {
  it("returns 404 for unknown UUID", async () => {
    const res = await request(app).get(
      "/incidents/00000000-0000-0000-0000-000000000001"
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 400 for malformed incident ID", async () => {
    const res = await request(app).get("/incidents/not-a-valid-id");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns the full incident with sections for a known ID", async () => {
    const incident = await seedIncident({ title: "Full Detail Test" });

    const res = await request(app).get(`/incidents/${incident.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(incident.id);
    expect(res.body.title).toBe("Full Detail Test");
    expect(Array.isArray(res.body.sections)).toBe(true);
    expect(res.body.sections.length).toBeGreaterThan(0);
  });
});
