# Incident Atlas Pro - API Specification (Week 1 Freeze)

## Core Endpoints

### 1. Document Management & Ingestion

**`POST /documents/upload`**
- **Description:** Upload a raw incident document.
- **Request Body:** Multipart form containing the file.
- **Response:** Returns the created document object with `id` and `upload_status`.

**`GET /documents/:id`**
- **Description:** Retrieve the raw uploaded document and its status.

**`POST /ingest/:documentId`**
- **Description:** Trigger the extraction pipeline (chunking, entity extraction) for a previously uploaded document.
- **Response:** `202 Accepted` (Processing async)

### 2. Search & Retrieval
**`GET /api/v1/search`**
- **Description:** Hybrid search (Keyword + Vector + Reranking) across incident sections.
- **Query Params:**
  - `q` (string): Search query
  - `filter_service` (string): Filter by impacted service
  - `filter_severity` (string): Filter by severity
- **Response:** Array of matched incidents with `score` and matching `sections` (evidence).

### 3. Incident Details & Similarity
**`GET /incidents/:id`**
- **Description:** Fetch full metadata, exactly extracted sections (impact, timeline, root_cause, mitigation), and linked entities for a specific incident.

**`GET /incidents/:id/similar`**
- **Description:** Find past incidents similar to the specified incident.
- **Response:** Array of incidents with a `similarity_reason` explaining why they matched.

### 4. Knowledge Graph Explorer
**`GET /api/v1/graph/entities`**
- **Description:** List top recurring entities (e.g., most common failing services or root causes).

**`GET /api/v1/graph/neighbors/{entity_id}`**
- **Description:** Get all incidents linked to an entity, and standard co-occurring entities.

### 5. AI Features
**`POST /api/v1/qa`**
- **Description:** Question answering over incident data using RAG. Returns citations or refuses if insufficient evidence.

**`POST /api/v1/postmortem/generate-outline`**
- **Description:** Generates a postmortem template filled with known, verified facts.
