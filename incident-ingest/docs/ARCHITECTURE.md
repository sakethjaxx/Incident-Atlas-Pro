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

## Data flow (happy path)
Upload/Crawl → parse → extract fields → section → embed → index → graph extract → ready for search/graph
