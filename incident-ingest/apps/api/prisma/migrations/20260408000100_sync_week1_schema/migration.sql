CREATE TYPE "ParseStatus" AS ENUM ('pending', 'processing', 'done', 'failed');

CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'success', 'failed');

CREATE TYPE "SourceType" AS ENUM ('blog', 'statuspage', 'github', 'pdf', 'manual');

ALTER TABLE "incidents"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "document_id" UUID,
  ADD COLUMN "duration" TEXT,
  ADD COLUMN "products" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "source_url" TEXT,
  ALTER COLUMN "id" DROP DEFAULT;

ALTER TABLE "sections"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "id" DROP DEFAULT;

CREATE TABLE "sources" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "type" "SourceType" NOT NULL DEFAULT 'manual',
  "crawl_policy" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "documents" (
  "id" UUID NOT NULL,
  "source_id" UUID,
  "raw_path" TEXT,
  "raw_text" TEXT,
  "hash" TEXT,
  "fetched_at" TIMESTAMP(3),
  "parse_status" "ParseStatus" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ingest_jobs" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "stage" TEXT NOT NULL DEFAULT 'queued',
  "status" "JobStatus" NOT NULL DEFAULT 'queued',
  "error" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ingest_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sources_url_key" ON "sources"("url");

CREATE UNIQUE INDEX "ingest_jobs_document_id_key" ON "ingest_jobs"("document_id");

CREATE UNIQUE INDEX "incidents_document_id_key" ON "incidents"("document_id");

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ingest_jobs"
  ADD CONSTRAINT "ingest_jobs_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "incidents"
  ADD CONSTRAINT "incidents_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
