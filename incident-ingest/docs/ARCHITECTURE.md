# Architecture

## High-level
- **Frontend:** Next.js + Tailwind
- **Backend:** FastAPI (or Node/Express)
- **Workers:** Redis queue (RQ/Celery/BullMQ)
- **Data:**
  - Postgres for metadata
  - Vector DB: pgvector or Qdrant for embeddings
  - Graph stored in Postgres edge tables (Neo4j optional)
- **Storage:** S3/minio/local for raw docs + parsed artifacts
- **Observability:** structured logs + metrics; basic tracing

## Data Flow: Ingestion & Retrieval Pipeline
1. **Ingest/Parse:** Upload/Crawl → async queue worker reads `rawPath` → parse text.
2. **Sectioning:** Extract fields → split into sections (Impact, Timeline, Root Cause, Fix).
3. **Primary Embed:** Generate `text-embedding-3-small` vectors (1536 dims).
   - *Fallback:* `all-MiniLM-L6-v2` (Node.js native).
   - *Failure state:* On embedding failure, standard ingestion completes gracefully, leaving embeddings `NULL` for background backfill.
4. **Index:** Save to Postgres with `pgvector` index + FTS index.
5. **Retrieval:** `GET /search` runs query embedding, merging Vector + FTS, mapping vector distances to scores, and returning Section-level text as Evidence.
6. **Graph Extract:** (Sprint 3) → ready for graph relations.
