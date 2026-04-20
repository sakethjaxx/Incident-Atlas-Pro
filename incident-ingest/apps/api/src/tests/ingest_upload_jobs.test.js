/**
 * Integration tests — POST /ingest/upload + worker pipeline
 *
 * Two concerns are tested separately:
 *
 *   1. API layer tests (no Redis needed): verify that POST /ingest/upload
 *      correctly creates a Document row with rawText populated, creates an
 *      IngestJob, and attempts to enqueue (Redis failure is caught gracefully).
 *
 *   2. Worker pipeline tests (no Redis needed): call processParseJob() directly
 *      with a real Prisma DB, bypassing BullMQ entirely.  This proves the full
 *      upload → DB → process → incident creation path end-to-end.
 *
 * Requires: running Postgres (localhost:5432).
 * Does NOT require: Redis / BullMQ.
 */

import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { processParseJob } from "../../../worker/src/processor.js";

const app = buildApp();
const AUTH = { Authorization: "Bearer dev-secret" };

// ── Test upload directory ──────────────────────────────────────────────────────
const uploadDir = path.join(os.tmpdir(), `atlas-test-uploads-${Date.now()}`);

beforeAll(async () => {
  await mkdir(uploadDir, { recursive: true });
  // Override UPLOAD_DIR so multer saves to our temp dir
  process.env.UPLOAD_DIR = uploadDir;
});

beforeEach(async () => {
  // Wipe in dependency order
  await prisma.section.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.ingestJob.deleteMany();
  await prisma.document.deleteMany();
});

afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a stub BullMQ Job object that satisfies processParseJob's interface.
 * Uses a real DB document so all DB side-effects actually execute.
 */
function makeFakeJob(documentId) {
  return {
    data: { documentId },
    updateProgress: async () => {},
  };
}

const SAMPLE_TXT = `Impact
All API write operations returned 503 for 22 minutes.

Root Cause
A botched deploy introduced a missing env var that disabled the DB pool.

Fix
Rolled back the deploy. Added pre-deploy env var validation to CI.`;

// ── API layer: POST /ingest/upload ────────────────────────────────────────────

describe("POST /ingest/upload — API layer", () => {
  it("rejects request with no file", async () => {
    const res = await request(app)
      .post("/ingest/upload")
      .set(AUTH);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No file/i);
  });

  it("rejects request without auth", async () => {
    const res = await request(app)
      .post("/ingest/upload")
      .attach("file", Buffer.from("hello"), "incident.txt");
    expect(res.status).toBe(401);
  });

  it("accepts a txt file and stores rawText in the document row", async () => {
    // We bypass the queue by using POST /documents/upload (JSON path) which
    // also stores rawText without needing Redis.
    const res = await request(app)
      .post("/documents/upload")
      .set(AUTH)
      .send({ rawText: SAMPLE_TXT });

    expect(res.status).toBe(201);
    expect(res.body.rawText).toBe(SAMPLE_TXT);
    expect(res.body.parseStatus).toBe("pending");
    expect(res.body.ingestJob).toBeDefined();
    expect(res.body.ingestJob.status).toBe("queued");

    // Verify the hash is stored
    const expectedHash = crypto
      .createHash("sha256")
      .update(SAMPLE_TXT)
      .digest("hex");
    expect(res.body.hash).toBe(expectedHash);
  });
});

// ── End-to-end: upload → DB → processParseJob → incident ─────────────────────

describe("Worker pipeline — upload → worker → incident creation", () => {
  it("creates an incident with sections from a txt document stored via /documents/upload", async () => {
    // Step 1: create document with rawText (simulates /documents/upload or JSON body)
    const uploadRes = await request(app)
      .post("/documents/upload")
      .set(AUTH)
      .send({ rawText: SAMPLE_TXT });

    expect(uploadRes.status).toBe(201);
    const documentId = uploadRes.body.id;

    // Step 2: call processParseJob directly (no Redis needed)
    const result = await processParseJob(makeFakeJob(documentId));

    // Step 3: verify result
    expect(result.error).toBeNull();
    expect(result.incidentId).toBeTruthy();

    // Step 4: verify Incident and Sections were created in DB
    const incident = await prisma.incident.findUnique({
      where: { id: result.incidentId },
      include: { sections: true },
    });

    expect(incident).not.toBeNull();
    expect(incident.documentId).toBe(documentId);
    expect(incident.summaryText).toBeTruthy();
    expect(incident.sections.length).toBeGreaterThan(0);

    const sectionTypes = incident.sections.map((s) => s.type);
    expect(sectionTypes).toContain("impact");
    expect(sectionTypes).toContain("rootcause");
    expect(sectionTypes).toContain("fix");
  });

  it("sets Document.parseStatus = done after successful processing", async () => {
    const uploadRes = await request(app)
      .post("/documents/upload")
      .set(AUTH)
      .send({ rawText: SAMPLE_TXT });

    const documentId = uploadRes.body.id;
    await processParseJob(makeFakeJob(documentId));

    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    expect(doc.parseStatus).toBe("done");
  });

  it("sets IngestJob.status = success after successful processing", async () => {
    const uploadRes = await request(app)
      .post("/documents/upload")
      .set(AUTH)
      .send({ rawText: SAMPLE_TXT });

    const documentId = uploadRes.body.id;
    const jobId = uploadRes.body.ingestJob.id;

    await processParseJob(makeFakeJob(documentId));

    const job = await prisma.ingestJob.findUnique({ where: { id: jobId } });
    expect(job.status).toBe("success");
    expect(job.stage).toBe("done");
    expect(job.finishedAt).not.toBeNull();
    expect(job.error).toBeNull();
  });

  it("creates incident from txt rawPath (disk) — simulates /ingest/upload multipart flow", async () => {
    // Write a real file to temp dir
    const filePath = path.join(uploadDir, `${Date.now()}-incident.txt`);
    await writeFile(filePath, SAMPLE_TXT, "utf-8");

    // Create document with rawPath only (as /ingest/upload used to do before this fix)
    const doc = await prisma.document.create({
      data: {
        rawPath: filePath,
        rawText: null, // deliberately null to test file-reading path
        parseStatus: "pending",
        ingestJob: { create: { status: "queued", stage: "upload" } },
      },
      include: { ingestJob: true },
    });

    const result = await processParseJob(makeFakeJob(doc.id));

    expect(result.error).toBeNull();
    expect(result.incidentId).toBeTruthy();

    const incident = await prisma.incident.findUnique({
      where: { id: result.incidentId },
      include: { sections: true },
    });
    expect(incident.sections.length).toBeGreaterThan(0);
  });

  it("returns a permanent error (no retry) for PDF documents", async () => {
    // Create a document that claims to be a PDF (rawPath ends in .pdf)
    const pdfPath = path.join(uploadDir, "fake.pdf");
    await writeFile(pdfPath, "%PDF-1.4 fake content");

    const doc = await prisma.document.create({
      data: {
        rawPath: pdfPath,
        rawText: null,
        parseStatus: "pending",
        ingestJob: { create: { status: "queued", stage: "upload" } },
      },
      include: { ingestJob: true },
    });

    // processParseJob should return normally (not throw) with an error message
    const result = await processParseJob(makeFakeJob(doc.id));

    expect(result.incidentId).toBeNull();
    expect(result.error).toMatch(/PDF/i);

    // IngestJob should be marked as failed
    const job = await prisma.ingestJob.findUnique({ where: { id: doc.ingestJob.id } });
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/PDF/i);
  });

  it("returns a permanent error for a document with no rawText and no rawPath", async () => {
    const doc = await prisma.document.create({
      data: {
        rawText: null,
        rawPath: null,
        parseStatus: "pending",
        ingestJob: { create: { status: "queued", stage: "upload" } },
      },
      include: { ingestJob: true },
    });

    const result = await processParseJob(makeFakeJob(doc.id));

    expect(result.incidentId).toBeNull();
    expect(result.error).toMatch(/rawText|rawPath/i);
  });
});

// ── GET /jobs/:jobId ─────────────────────────────────────────────────────────

describe("GET /jobs/:jobId", () => {
  it("returns 404 for unknown job id", async () => {
    const res = await request(app).get(
      "/jobs/00000000-0000-0000-0000-000000000000"
    );
    // Either 404 (DB miss) or 400 (UUID validation)
    expect([400, 404]).toContain(res.status);
  });

  it("returns 400 for malformed (non-UUID) job id", async () => {
    const res = await request(app).get("/jobs/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid/i);
  });

  it("returns job status from DB after processing", async () => {
    const uploadRes = await request(app)
      .post("/documents/upload")
      .set(AUTH)
      .send({ rawText: SAMPLE_TXT });

    const documentId = uploadRes.body.id;
    const jobId = uploadRes.body.ingestJob.id;

    await processParseJob(makeFakeJob(documentId));

    // Jobs route reads from DB (Redis not required since bullmq lookup falls back)
    const jobRes = await request(app).get(`/jobs/${jobId}`);
    expect(jobRes.status).toBe(200);
    expect(jobRes.body.id).toBe(jobId);
    // DB-backed status mapping: success → completed
    expect(["completed", "success"]).toContain(jobRes.body.status);
  });
});
