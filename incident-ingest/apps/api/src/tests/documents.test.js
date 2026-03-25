/**
 * Integration tests — Documents routes
 * Requires a running Postgres DB.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = buildApp();
const AUTH = { Authorization: "Bearer dev-secret" };

beforeEach(async () => {
  await prisma.ingestJob.deleteMany();
  await prisma.document.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /documents/upload", () => {
  it("creates a document and ingest job", async () => {
    const res = await request(app)
      .post("/documents/upload")
      .set(AUTH)
      .send({ rawText: "Impact\nAPI down.\n\nFix\nRolled back." });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.parseStatus).toBe("pending");
    expect(res.body.ingestJob).toBeDefined();
    expect(res.body.ingestJob.status).toBe("queued");
  });

  it("returns 400 when rawText is missing", async () => {
    const res = await request(app)
      .post("/documents/upload")
      .set(AUTH)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rawText/);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/documents/upload")
      .send({ rawText: "some text" });

    expect(res.status).toBe(401);
  });

  it("stores a sha256 hash of the content", async () => {
    const res = await request(app)
      .post("/documents/upload")
      .set(AUTH)
      .send({ rawText: "deterministic content" });

    expect(res.status).toBe(201);
    expect(res.body.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("GET /documents/:id", () => {
  it("returns document with ingestJob", async () => {
    const upload = await request(app)
      .post("/documents/upload")
      .set(AUTH)
      .send({ rawText: "Test document content here." });

    const res = await request(app).get(`/documents/${upload.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(upload.body.id);
    expect(res.body.ingestJob).toBeDefined();
  });

  it("returns 404 for unknown document id", async () => {
    const res = await request(app).get(
      "/documents/00000000-0000-0000-0000-000000000000"
    );
    expect(res.status).toBe(404);
  });
});
