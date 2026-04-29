CREATE EXTENSION IF NOT EXISTS "vector";

ALTER TABLE "incidents"
  ADD COLUMN IF NOT EXISTS "summary_embedding" vector(1536);

ALTER TABLE "sections"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

CREATE INDEX IF NOT EXISTS "incidents_text_search_idx"
  ON "incidents"
  USING gin (
    to_tsvector(
      'english',
      coalesce("title", '') || ' ' ||
      coalesce("summary_text", '') || ' ' ||
      coalesce("company", '')
    )
  );

CREATE INDEX IF NOT EXISTS "sections_text_search_idx"
  ON "sections"
  USING gin (to_tsvector('english', coalesce("text", '')));

CREATE INDEX IF NOT EXISTS "incidents_summary_embedding_idx"
  ON "incidents"
  USING ivfflat ("summary_embedding" vector_cosine_ops)
  WITH (lists = 20);

CREATE INDEX IF NOT EXISTS "sections_embedding_idx"
  ON "sections"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 20);
