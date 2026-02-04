CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "SectionType" AS ENUM ('impact', 'timeline', 'rootcause', 'fix');

CREATE TABLE "incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "company" TEXT,
    "severity" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "summary_text" TEXT,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "type" "SectionType" NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sections" ADD CONSTRAINT "sections_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "sections_incident_id_idx" ON "sections"("incident_id");
