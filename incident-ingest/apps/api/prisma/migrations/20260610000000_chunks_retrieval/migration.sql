-- Sprint 5: retrieval chunks + HNSW vector indexes (open-source RAG stack)
--
-- 1. chunks table: section + paragraph retrieval granularity with exact
--    citation anchors and denormalized metadata for filter-first retrieval.
-- 2. HNSW indexes (pgvector >= 0.5). Each HNSW CREATE is wrapped in a DO
--    block that falls back to IVFFlat on older pgvector versions, so the
--    migration never hard-fails on the vector index flavor.
-- 3. Upgrades the Sprint 2 IVFFlat indexes on incidents/sections to HNSW
--    where supported (drop + recreate; tables are small at this stage).

CREATE TABLE "chunks" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "section_type" "SectionType" NOT NULL,
    "chunk_type" TEXT NOT NULL DEFAULT 'section',
    "chunk_index" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "company" TEXT,
    "severity" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "products" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "embedding" vector(1536),
    "embedding_provider" TEXT,
    "embedding_model" TEXT,
    "embedding_dim" INTEGER,
    "tq_codes" BYTEA,
    "tq_residual" BYTEA,
    "tq_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chunks_incident_id_idx" ON "chunks"("incident_id");
CREATE INDEX "chunks_section_id_idx" ON "chunks"("section_id");
CREATE INDEX "chunks_company_idx" ON "chunks"("company");
CREATE INDEX "chunks_severity_idx" ON "chunks"("severity");

ALTER TABLE "chunks"
  ADD CONSTRAINT "chunks_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "incidents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chunks"
  ADD CONSTRAINT "chunks_section_id_fkey"
  FOREIGN KEY ("section_id") REFERENCES "sections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Full-text search over chunk text (same expression style as sections).
CREATE INDEX "chunks_text_search_idx"
  ON "chunks"
  USING gin (to_tsvector('english', coalesce("text", '')));

-- Vector ANN index: HNSW preferred, IVFFlat fallback for old pgvector.
DO $$
BEGIN
  BEGIN
    CREATE INDEX "chunks_embedding_hnsw_idx"
      ON "chunks"
      USING hnsw ("embedding" vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'HNSW unavailable (%), falling back to IVFFlat for chunks', SQLERRM;
    CREATE INDEX "chunks_embedding_ivf_idx"
      ON "chunks"
      USING ivfflat ("embedding" vector_cosine_ops)
      WITH (lists = 100);
  END;
END $$;

-- Upgrade Sprint 2 IVFFlat indexes to HNSW where the extension supports it.
DO $$
BEGIN
  BEGIN
    DROP INDEX IF EXISTS "incidents_summary_embedding_idx";
    CREATE INDEX "incidents_summary_embedding_idx"
      ON "incidents"
      USING hnsw ("summary_embedding" vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'HNSW unavailable (%), restoring IVFFlat for incidents', SQLERRM;
    CREATE INDEX IF NOT EXISTS "incidents_summary_embedding_idx"
      ON "incidents"
      USING ivfflat ("summary_embedding" vector_cosine_ops)
      WITH (lists = 20);
  END;

  BEGIN
    DROP INDEX IF EXISTS "sections_embedding_idx";
    CREATE INDEX "sections_embedding_idx"
      ON "sections"
      USING hnsw ("embedding" vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'HNSW unavailable (%), restoring IVFFlat for sections', SQLERRM;
    CREATE INDEX IF NOT EXISTS "sections_embedding_idx"
      ON "sections"
      USING ivfflat ("embedding" vector_cosine_ops)
      WITH (lists = 20);
  END;
END $$;
