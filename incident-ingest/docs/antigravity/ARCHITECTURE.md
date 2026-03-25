# Incident Atlas Pro - System Architecture (Week 1 Freeze)

## 1. High-Level Components

- **Frontend (Web App):** Interface containing Search, Incident Details, Graph Explorer, and Q&A panels.
- **API Gateway / Backend:** Serves REST APIs, handles queries, and coordinates data flow.
- **Ingestion Worker:** Background process that processes raw text, chunks it into sections, calls an LLM to extract entities, generates embeddings, and saves to the DB.
- **Database Store (e.g., PostgreSQL + pgvector):** Unified store for relational data, FTS indexes, and vector embeddings.

## 2. Data Flow: Ingestion Pipeline
1. Client submits raw incident data to `POST /api/v1/ingest`.
2. Backend queues the ingestion task.
3. **Chunking & Sectioning:** NLP worker splits the document into `impact`, `timeline`, `root_cause`, `mitigation`.
4. **Entity Extraction:** LLM extracts services, symptoms, and causes to populate the `entities` table.
5. **Embedding:** Worker generates vector embeddings for each section using a chosen embedding model.
6. Data is committed to the Database.

## 3. Data Flow: Hybrid Search
1. Client queries `GET /api/v1/search?q=database timeout`.
2. Backend runs **Full-Text Search (FTS)** on lexical fields.
3. Backend simultaneously runs **Vector Similarity Search** using the query's embedding.
4. Results are merged and scored (e.g., Reciprocal Rank Fusion) and optionally reranked by a cross-encoder.
5. Top `K` results are returned with exact section citations as evidence.
