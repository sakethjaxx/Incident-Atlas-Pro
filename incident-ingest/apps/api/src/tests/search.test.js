/**
 * Integration tests — GET /search
 * Requires a running Postgres DB.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = buildApp();
const AUTH = { Authorization: "Bearer dev-secret" };

async function seedIncident(overrides = {}) {
  return prisma.incident.create({
    data: {
      title: overrides.title ?? "Database Connection Pool Exhaustion",
      company: overrides.company ?? "Acme",
      severity: overrides.severity ?? "SEV-2",
      tags: overrides.tags ?? ["database", "connection"],
      date: overrides.date ? new Date(overrides.date) : new Date("2026-01-10"),
      summaryText: overrides.summaryText ?? "DB pool reached max connections causing cascade failures.",
      sections: {
        create: [
          { type: "impact", text: overrides.impactText ?? "50% of API requests failed." },
          { type: "rootcause", text: "DB connection pool exhausted under load spike." },
          { type: "fix", text: "Increased pool size and added circuit breaker." },
        ],
      },
    },
  });
}

beforeEach(async () => {
  await prisma.section.deleteMany();
  await prisma.incident.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /search", () => {
  it("requires q parameter", async () => {
    const res = await request(app).get("/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/q/);
  });

  it("returns matching incident by title keyword", async () => {
    await seedIncident({ title: "Redis Cache Miss Epidemic" });
    await seedIncident({ title: "Network Partition Event" });

    const res = await request(app).get("/search?q=redis");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].title).toMatch(/Redis/i);
  });

  it("returns matching incident by section text", async () => {
    await seedIncident({ impactText: "All writes to MongoDB began timing out" });

    const res = await request(app).get("/search?q=MongoDB");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const sections = res.body.data[0].sections;
    expect(sections.some((s) => s.text.includes("MongoDB"))).toBe(true);
  });

  it("filters by company", async () => {
    await seedIncident({ title: "Outage A", company: "Alpha" });
    await seedIncident({ title: "Outage B", company: "Beta" });

    const res = await request(app).get("/search?q=outage&company=Alpha");
    expect(res.status).toBe(200);
    expect(res.body.data.every((i) => i.company === "Alpha")).toBe(true);
  });

  it("filters by tag", async () => {
    await seedIncident({ title: "Cert Expiry", tags: ["ssl", "cert"] });
    await seedIncident({ title: "DB Issue", tags: ["database"] });

    const res = await request(app).get("/search?q=cert&tag=ssl");
    expect(res.status).toBe(200);
    expect(res.body.data.every((i) => i.tags.includes("ssl"))).toBe(true);
  });

  it("filters by date range", async () => {
    await seedIncident({ title: "Old Incident", date: "2025-01-01" });
    await seedIncident({ title: "New Incident", date: "2026-02-01" });

    const res = await request(app).get("/search?q=incident&from=2026-01-01");
    expect(res.status).toBe(200);
    expect(res.body.data.every((i) => new Date(i.date) >= new Date("2026-01-01"))).toBe(true);
  });

  it("returns empty array when no matches", async () => {
    await seedIncident({ title: "Unrelated Thing" });

    const res = await request(app).get("/search?q=xyzzy_nonexistent_term");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("paginates results", async () => {
    for (let i = 0; i < 5; i++) {
      await seedIncident({ title: `Paginate Incident ${i}` });
    }

    const res = await request(app).get("/search?q=paginate&limit=2&page=1");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.limit).toBe(2);
    expect(res.body.total).toBeGreaterThanOrEqual(5);
  });
});
