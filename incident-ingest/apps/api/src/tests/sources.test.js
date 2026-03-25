/**
 * Integration tests — Sources routes
 * Requires a running Postgres DB (docker compose up -d).
 * Uses the DATABASE_URL from .env (or .env.test if present).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = buildApp();
const AUTH = { Authorization: "Bearer dev-secret" };

beforeEach(async () => {
  // Clean up sources between tests (cascade to documents)
  await prisma.source.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /sources", () => {
  it("creates a source with valid data", async () => {
    const res = await request(app)
      .post("/sources")
      .set(AUTH)
      .send({ name: "GitHub Incidents", url: "https://github.com/example/repo", type: "github" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe("GitHub Incidents");
    expect(res.body.type).toBe("github");
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(app)
      .post("/sources")
      .set(AUTH)
      .send({ url: "https://example.com" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it("returns 400 when url is missing", async () => {
    const res = await request(app)
      .post("/sources")
      .set(AUTH)
      .send({ name: "Test" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/);
  });

  it("returns 409 on duplicate URL", async () => {
    const payload = { name: "A", url: "https://duplicate.test" };
    await request(app).post("/sources").set(AUTH).send(payload);
    const res = await request(app).post("/sources").set(AUTH).send(payload);

    expect(res.status).toBe(409);
  });

  it("returns 401 without admin token", async () => {
    const res = await request(app)
      .post("/sources")
      .send({ name: "Unauth", url: "https://unauth.test" });

    expect(res.status).toBe(401);
  });
});

describe("GET /sources", () => {
  it("returns an empty array when no sources exist", async () => {
    const res = await request(app).get("/sources");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns created sources", async () => {
    await request(app)
      .post("/sources")
      .set(AUTH)
      .send({ name: "StatusPage", url: "https://status.example.com" });

    const res = await request(app).get("/sources");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });
});
