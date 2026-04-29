/**
 * W2-004 — Integration tests for GET /search
 *
 * Tests the frozen API_SPEC contract:
 *   - results key (array of { incident, score, evidence })
 *   - backward-compat data alias
 *   - filters: company, severity, tag, date range
 *   - no-results path
 *   - malformed / missing input → 400
 *   - pagination
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
        overrides.summaryText ?? "DB pool reached max connections causing cascade failures.",
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

// ── Input validation ──────────────────────────────────────────────────────────

describe("GET /search — input validation", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/q/);
  });

  it("returns 400 when q is empty string", async () => {
    const res = await request(app).get("/search?q=");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/q/);
  });

  it("returns 400 when q exceeds 500 characters", async () => {
    const q = "a".repeat(501);
    const res = await request(app).get(`/search?q=${q}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/500/);
  });
});

// ── Response shape contract ───────────────────────────────────────────────────

describe("GET /search — response shape", () => {
  it("returns results array with incident, score, evidence shape", async () => {
    await seedIncident({ title: "Redis Cache Miss Epidemic" });

    const res = await request(app).get("/search?q=redis");
    expect(res.status).toBe(200);

    // Top-level contract keys
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.page).toBe("number");
    expect(typeof res.body.limit).toBe("number");
    expect(typeof res.body.q).toBe("string");
    expect(res.body.filters).toBeDefined();

    // Also backward-compat `data` alias
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toEqual(res.body.results);
  });

  it("each result has incident object, score, and evidence array", async () => {
    await seedIncident({ title: "Redis Cache Miss Epidemic" });

    const res = await request(app).get("/search?q=redis");
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);

    const result = res.body.results[0];
    // incident sub-object
    expect(result.incident).toBeDefined();
    expect(typeof result.incident.id).toBe("string");
    expect(typeof result.incident.title).toBe("string");
    expect(Array.isArray(result.incident.tags)).toBe(true);

    // score
    expect(typeof result.score).toBe("number");
    expect(result.score).toBeGreaterThan(0);

    // evidence array (may be empty for no section match, but must be array)
    expect(Array.isArray(result.evidence)).toBe(true);
  });

  it("evidence items have id, type, text fields", async () => {
    await seedIncident({ impactText: "All writes to MongoDB began timing out" });

    const res = await request(app).get("/search?q=MongoDB");
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThanOrEqual(1);

    const evidencePieces = res.body.results[0].evidence;
    expect(evidencePieces.length).toBeGreaterThan(0);
    const ev = evidencePieces[0];
    expect(typeof ev.id).toBe("string");
    expect(typeof ev.type).toBe("string");
    expect(typeof ev.text).toBe("string");
  });

  it("filters echo in response", async () => {
    await seedIncident({ title: "Outage A", company: "Alpha" });

    const res = await request(app).get("/search?q=outage&company=Alpha");
    expect(res.status).toBe(200);
    expect(res.body.filters.company).toBe("Alpha");
  });
});

// ── Keyword matching ──────────────────────────────────────────────────────────

describe("GET /search — keyword matching", () => {
  it("returns matching incident by title keyword", async () => {
    await seedIncident({ title: "Redis Cache Miss Epidemic" });
    await seedIncident({ title: "Network Partition Event" });

    const res = await request(app).get("/search?q=redis");
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(1);
    expect(res.body.results[0].incident.title).toMatch(/Redis/i);
    expect(res.body.results[0].score).toBeGreaterThan(0);
  });

  it("returns matching incident by section text with highlight in evidence", async () => {
    await seedIncident({ impactText: "All writes to MongoDB began timing out" });

    const res = await request(app).get("/search?q=MongoDB");
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThanOrEqual(1);

    // Evidence includes the matched section
    const evidence = res.body.results[0].evidence;
    expect(evidence.some((e) => e.text.includes("MongoDB"))).toBe(true);

    // Highlight is set on matched evidence
    const mongoEvidence = evidence.find((e) => e.text.includes("MongoDB"));
    expect(mongoEvidence.highlight).toMatch(/MongoDB/i);
  });

  it("returns empty results array when no matches", async () => {
    await seedIncident({ title: "Unrelated Thing" });

    const res = await request(app).get("/search?q=xyzzy_nonexistent_term");
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });
});

// ── Filters ───────────────────────────────────────────────────────────────────

describe("GET /search — filters", () => {
  it("filters by company (case-insensitive)", async () => {
    await seedIncident({ title: "Outage A", company: "Alpha" });
    await seedIncident({ title: "Outage B", company: "Beta" });

    const res = await request(app).get("/search?q=outage&company=Alpha");
    expect(res.status).toBe(200);
    expect(res.body.results.every((r) => r.incident.company === "Alpha")).toBe(true);
  });

  it("filters by tag", async () => {
    await seedIncident({ title: "Cert Expiry", tags: ["ssl", "cert"] });
    await seedIncident({ title: "DB Issue", tags: ["database"] });

    const res = await request(app).get("/search?q=cert&tag=ssl");
    expect(res.status).toBe(200);
    expect(res.body.results.every((r) => r.incident.tags.includes("ssl"))).toBe(true);
  });

  it("filters by severity", async () => {
    await seedIncident({ title: "Critical API Outage", severity: "SEV-1" });
    await seedIncident({ title: "Minor API Outage", severity: "SEV-3" });

    const res = await request(app).get("/search?q=outage&severity=SEV-1");
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].incident.severity).toBe("SEV-1");
  });

  it("filters by date range (from)", async () => {
    await seedIncident({ title: "Old Incident", date: "2025-01-01" });
    await seedIncident({ title: "New Incident", date: "2026-02-01" });

    const res = await request(app).get("/search?q=incident&from=2026-01-01");
    expect(res.status).toBe(200);
    expect(
      res.body.results.every((r) => new Date(r.incident.date) >= new Date("2026-01-01"))
    ).toBe(true);
  });

  it("filters by date range (to)", async () => {
    await seedIncident({ title: "Old Incident", date: "2025-01-01" });
    await seedIncident({ title: "New Incident", date: "2026-02-01" });

    const res = await request(app).get("/search?q=incident&to=2025-12-31");
    expect(res.status).toBe(200);
    expect(
      res.body.results.every((r) => new Date(r.incident.date) <= new Date("2025-12-31"))
    ).toBe(true);
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe("GET /search — pagination", () => {
  it("paginates results with limit and page", async () => {
    for (let i = 0; i < 5; i++) {
      await seedIncident({ title: `Paginate Incident ${i}` });
    }

    const res = await request(app).get("/search?q=paginate&limit=2&page=1");
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(2);
    expect(res.body.limit).toBe(2);
    expect(res.body.total).toBeGreaterThanOrEqual(5);
  });

  it("clamps limit to max 50", async () => {
    await seedIncident({ title: "Clamp Test Incident" });

    const res = await request(app).get("/search?q=clamp&limit=200");
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(50);
  });
});
