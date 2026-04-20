# Incident Atlas Pro - Data Model (Week 1 Freeze)

## 1. Relational Tables

### `documents`
Stores raw uploaded incident reports before processing.
- `id` (UUID, Primary Key)
- `job_id` (UUID, indexed) - Reference to the ingestion background job.
- `filename` (String)
- `raw_content` (Text)
- `mime_type` (String - pdf/md/txt)
- `parse_status` (Enum: waiting, active, completed, failed) - Job lifecycle tracking.
- `error_details` (Text, nullable) - Populated if parse_status is failed.
- `created_at` (Timestamp)
- `updated_at` (Timestamp)

### `incidents`
Stores core metadata for each ingested incident.
- `id` (UUID, Primary Key)
- `document_id` (UUID, Foreign Key -> documents.id, nullable)
- `title` (String)
- `summary` (Text)
- `status` (Enum: investigating, resolved, postmortem_completed)
- `severity` (String)
- `incident_date` (Timestamp)
- `created_at` (Timestamp)
- `source_url` (String, nullable) - Link to original doc or system

### `incident_sections`
Breaks down the incident into searchable chunks for better retrieval.
- `id` (UUID, Primary Key)
- `incident_id` (UUID, Foreign Key -> incidents.id)
- `section_type` (Enum: impact, timeline, root_cause, mitigation, general)
- `content` (Text)
- `vector_embedding` (Vector/Array) - Used for similarity search
- `created_at` (Timestamp)

### `entities` (Knowledge Graph Nodes)
Tracks services, symptoms, and causes across incidents.
- `id` (UUID, Primary Key)
- `name` (String) - e.g., "auth-service", "high latency", "db-connection-pool-exhaustion"
- `type` (Enum: service, symptom, cause)

### `incident_entities` (Knowledge Graph Edges)
Maps incidents to the entities involved.
- `incident_id` (UUID, Foreign Key)
- `entity_id` (UUID, Foreign Key)
- `relationship_context` (Text) - How the entity relates to the incident

## 2. Document/Vector Store Strategy
- **Vectors:** Stored directly in `incident_sections.vector_embedding` (e.g., using pgvector).
- **FTS Engine:** Standard full-text search indexed on `incidents.title`, `incidents.summary`, and `incident_sections.content`.
