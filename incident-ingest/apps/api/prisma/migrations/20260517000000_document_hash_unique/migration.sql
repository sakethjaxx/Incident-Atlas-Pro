-- AddUniqueConstraint: Document.hash
-- Prevents duplicate file ingestion. Files with identical SHA-256 hashes
-- are rejected at upload time with 409 Conflict.
--
-- If existing data has duplicate hashes, deduplicate first:
--   DELETE FROM documents a USING documents b
--   WHERE a.id > b.id AND a.hash = b.hash AND a.hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "documents_hash_key" ON "documents"("hash") WHERE "hash" IS NOT NULL;
