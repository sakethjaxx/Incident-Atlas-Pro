/**
 * Migration smoke test — verifies Postgres is reachable and all expected
 * tables exist, confirming migrations applied cleanly.
 *
 * Requires a running Postgres DB with migrations applied.
 */
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../lib/prisma.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("DB connectivity", () => {
  it("can connect to Postgres", async () => {
    const result = await prisma.$queryRaw`SELECT 1 AS ok`;
    expect(result[0].ok).toBe(1);
  });
});

describe("Table existence (migration smoke test)", () => {
  const expectedTables = [
    "sources",
    "documents",
    "ingest_jobs",
    "incidents",
    "sections",
  ];

  for (const table of expectedTables) {
    it(`table "${table}" exists`, async () => {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT to_regclass('public.${table}') AS tbl`
      );
      expect(rows[0].tbl).toBe(table);
    });
  }
});

describe("Basic CRUD smoke tests", () => {
  it("can insert and select an incident with sections", async () => {
    // Create
    const incident = await prisma.incident.create({
      data: {
        title: "Smoke Test Incident",
        sections: {
          create: [
            { type: "impact", text: "Smoke test impact text." },
            { type: "fix", text: "Smoke test fix text." },
          ],
        },
      },
      include: { sections: true },
    });

    expect(incident.id).toBeDefined();
    expect(incident.sections).toHaveLength(2);

    // Read back
    const found = await prisma.incident.findUnique({
      where: { id: incident.id },
      include: { sections: true },
    });
    expect(found?.title).toBe("Smoke Test Incident");
    expect(found?.sections).toHaveLength(2);

    // Cleanup
    await prisma.incident.delete({ where: { id: incident.id } });
  });

  it("cascade-deletes sections when incident is deleted", async () => {
    const incident = await prisma.incident.create({
      data: {
        title: "Cascade Test Incident",
        sections: { create: [{ type: "timeline", text: "t1" }] },
      },
    });

    await prisma.incident.delete({ where: { id: incident.id } });

    const sections = await prisma.section.findMany({
      where: { incidentId: incident.id },
    });
    expect(sections).toHaveLength(0);
  });

  it("can insert and select a source", async () => {
    const source = await prisma.source.create({
      data: { name: "Smoke Source", url: `https://smoke-test-${Date.now()}.example.com` },
    });
    expect(source.id).toBeDefined();
    await prisma.source.delete({ where: { id: source.id } });
  });

  it("can insert a document with ingest job", async () => {
    const doc = await prisma.document.create({
      data: {
        rawText: "smoke test content",
        hash: "abc123",
        parseStatus: "pending",
        ingestJob: { create: { status: "queued", stage: "queued" } },
      },
      include: { ingestJob: true },
    });

    expect(doc.id).toBeDefined();
    expect(doc.ingestJob?.status).toBe("queued");

    await prisma.document.delete({ where: { id: doc.id } });
  });
});
