/**
 * Integration tests — POST /ingest/manual
 * Requires a running Postgres DB.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = buildApp();
const AUTH = { Authorization: "Bearer dev-secret" };

beforeEach(async () => {
  await prisma.section.deleteMany();
  await prisma.incident.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const SAMPLE_TEXT = `Impact
About 30% of API requests failed with 500 errors for 25 minutes.

Root Cause
A misconfigured feature flag disabled the DB connection pool.

Fix
Rolled back the feature flag deployment. Added automated flag validation.`;

describe("POST /ingest/manual", () => {
  it("creates an incident with parsed sections", async () => {
    const res = await request(app)
      .post("/ingest/manual")
      .set(AUTH)
      .send({ title: "API Outage", rawText: SAMPLE_TEXT, company: "Acme" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe("API Outage");
    expect(res.body.company).toBe("Acme");
    expect(Array.isArray(res.body.sections)).toBe(true);
    expect(res.body.sections.length).toBeGreaterThan(0);
  });

  it("creates correct section types from headings", async () => {
    const res = await request(app)
      .post("/ingest/manual")
      .set(AUTH)
      .send({ title: "Sectioned Incident", rawText: SAMPLE_TEXT });

    expect(res.status).toBe(201);
    const types = res.body.sections.map((s) => s.type);
    expect(types).toContain("impact");
    expect(types).toContain("rootcause");
    expect(types).toContain("fix");
  });

  it("builds summaryText from the rawText", async () => {
    const res = await request(app)
      .post("/ingest/manual")
      .set(AUTH)
      .send({ title: "Summary Test", rawText: SAMPLE_TEXT });

    expect(res.status).toBe(201);
    expect(res.body.summaryText).toBeTruthy();
  });

  it("accepts optional metadata fields", async () => {
    const res = await request(app)
      .post("/ingest/manual")
      .set(AUTH)
      .send({
        title: "Full Meta",
        rawText: SAMPLE_TEXT,
        company: "CorpX",
        date: "2026-01-15T00:00:00Z",
        severity: "SEV-1",
        tags: ["database", "deploy"],
        products: ["API", "Auth Service"],
        sourceUrl: "https://corp.status.io/incident/123",
      });

    expect(res.status).toBe(201);
    expect(res.body.severity).toBe("SEV-1");
    expect(res.body.tags).toContain("database");
    expect(res.body.products).toContain("API");
    expect(res.body.sourceUrl).toContain("123");
    expect(new Date(res.body.date).getFullYear()).toBe(2026);
  });

  it("returns 400 when title is missing", async () => {
    const res = await request(app)
      .post("/ingest/manual")
      .set(AUTH)
      .send({ rawText: SAMPLE_TEXT });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/);
  });

  it("returns 400 when rawText is missing", async () => {
    const res = await request(app)
      .post("/ingest/manual")
      .set(AUTH)
      .send({ title: "No text" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rawText/);
  });

  it("returns 400 for invalid date", async () => {
    const res = await request(app)
      .post("/ingest/manual")
      .set(AUTH)
      .send({ title: "Bad Date", rawText: SAMPLE_TEXT, date: "not-a-date" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ISO-8601/);
  });

  it("returns 401 without admin auth", async () => {
    const res = await request(app)
      .post("/ingest/manual")
      .send({ title: "No Auth", rawText: SAMPLE_TEXT });

    expect(res.status).toBe(401);
  });
});
