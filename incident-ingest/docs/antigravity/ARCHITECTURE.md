# Incident Atlas Pro - System Architecture (Week 1 Freeze)

## 1. High-Level Components

- **Frontend (Web App):** Interface containing Search, Incident Details, Graph Explorer, and Q&A panels.
- **API Gateway / Backend:** Serves REST APIs, handles queries, and coordinates data flow.
- **Ingestion Worker:** Background process that processes raw text, chunks it into sections, calls an LLM to extract entities, generates embeddings, and saves to the DB.
- **Database Store (e.g., PostgreSQL + pgvector):** Unified store for relational data, FTS indexes, and vector embeddings.

## 2. Data Flow: Ingestion Pipeline & Worker Queue
1. Client submits raw incident data to `POST /ingest/upload`.
2. API Gateway queues an ingestion job (status: `waiting`) and returns the `jobId`.
3. Client polls `GET /jobs/:jobId` to monitor status.
4. Worker picks up the job, updates status to `active`, and creates the initial `documents` record.
5. Worker handles parsing (pdf/md/txt), chunking, sectioning, and LLM entity extraction.
6. **Success State:** Worker finalizes embeddings, links graph entities, and updates job/document `parse_status` to `completed`.
7. **Failure State:** If any step fails (timeout, bad format, LLM error), worker catches the error, updates status to `failed`, and logs `error_details`.

## 3. Data Flow: Hybrid Search
1. Client queries `GET /api/v1/search?q=database timeout`.
2. Backend runs **Full-Text Search (FTS)** on lexical fields.
3. Backend simultaneously runs **Vector Similarity Search** using the query's embedding.
4. Results are merged and scored (e.g., Reciprocal Rank Fusion) and optionally reranked by a cross-encoder.
5. Top `K` results are returned with exact section citations as evidence.
