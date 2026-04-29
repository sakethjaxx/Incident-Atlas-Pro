/**
 * Migration smoke test — verifies Postgres is reachable and all expected
 * tables exist, confirming migrations applied cleanly.
 *
 * Also verifies Sprint 2 additions:
 *   - pgvector extension installed
 *   - summary_embedding column on incidents
 *   - embedding column on sections
 *   - FTS + IVFFlat indexes created
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
        `SELECT EXISTS (
           SELECT 1
           FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = '${table}'
         ) AS present`
      );
      expect(rows[0].present).toBe(true);
    });
  }
});

describe("Sprint 2 — pgvector migration smoke", () => {
  it("pgvector extension is installed", async () => {
    const rows = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS installed
    `;
    expect(rows[0].installed).toBe(true);
  });

  it("incidents.summary_embedding column exists (vector type)", async () => {
    const rows = await prisma.$queryRaw`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'incidents'
        AND column_name  = 'summary_embedding'
    `;
    expect(rows).toHaveLength(1);
    // pgvector columns appear as USER-DEFINED udt
    expect(rows[0].udt_name).toBe("vector");
  });

  it("sections.embedding column exists (vector type)", async () => {
    const rows = await prisma.$queryRaw`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'sections'
        AND column_name  = 'embedding'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].udt_name).toBe("vector");
  });

  it("FTS index on incidents exists", async () => {
    const rows = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'incidents'
        AND indexname = 'incidents_text_search_idx'
    `;
    expect(rows).toHaveLength(1);
  });

  it("FTS index on sections exists", async () => {
    const rows = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'sections'
        AND indexname = 'sections_text_search_idx'
    `;
    expect(rows).toHaveLength(1);
  });

  it("IVFFlat index on incidents.summary_embedding exists", async () => {
    const rows = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'incidents'
        AND indexname = 'incidents_summary_embedding_idx'
    `;
    expect(rows).toHaveLength(1);
  });

  it("IVFFlat index on sections.embedding exists", async () => {
    const rows = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'sections'
        AND indexname = 'sections_embedding_idx'
    `;
    expect(rows).toHaveLength(1);
  });

  it("can write and read back a null embedding (embedding is nullable)", async () => {
    const incident = await prisma.incident.create({
      data: {
        title: "Sprint 2 Vector Null Test",
        summaryText: "An incident with no embedding yet.",
        sections: { create: [{ type: "impact", text: "Service was down." }] },
      },
      include: { sections: true },
    });

    // summary_embedding should be null — check using IS NULL cast to avoid
    // Prisma P2010: it cannot deserialize the `vector` UDT into a JS value.
    const nullCheck = await prisma.$queryRawUnsafe(
      'SELECT "summary_embedding" IS NULL AS is_null FROM incidents WHERE id = $1::uuid',
      incident.id
    );
    expect(nullCheck[0].is_null).toBe(true);

    // Write a real embedding via raw SQL (mirrors safeIndexIncidentEmbeddings)
    const { createEmbedding, formatEmbeddingForSql } = await import("@pkg/nlp");
    const vec = formatEmbeddingForSql(
      createEmbedding("Service was down. Database pool failed.")
    );
    await prisma.$executeRawUnsafe(
      'UPDATE incidents SET "summary_embedding" = $1::vector WHERE id = $2::uuid',
      vec,
      incident.id
    );

    // Read back — should not be null anymore (IS NOT NULL avoids vector deserialization)
    const after = await prisma.$queryRawUnsafe(
      'SELECT "summary_embedding" IS NOT NULL AS has_embedding FROM incidents WHERE id = $1::uuid',
      incident.id
    );
    expect(after[0].has_embedding).toBe(true);

    // Cleanup
    await prisma.incident.delete({ where: { id: incident.id } });
  });
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
