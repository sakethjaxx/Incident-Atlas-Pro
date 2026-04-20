# Data Model

## Sprint 1 — Shipped Schema

All models are defined in `apps/api/prisma/schema.prisma` and backed by PostgreSQL 16 (pgvector image).

### Enums

| Enum | Values |
|------|--------|
| `SectionType` | `impact`, `timeline`, `rootcause`, `fix` |
| `ParseStatus` | `pending`, `processing`, `done`, `failed` |
| `JobStatus` | `queued`, `running`, `success`, `failed` |
| `SourceType` | `blog`, `statuspage`, `github`, `pdf`, `manual` |

### Tables

#### `sources`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `name` | String | |
| `url` | String UNIQUE | |
| `type` | SourceType | default: `manual` |
| `crawl_policy` | JSON? | Sprint 3 crawler config |
| `created_at` | DateTime | |

#### `documents`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `source_id` | UUID FK → sources? | nullable for manual uploads |
| `raw_path` | String? | on-disk path of uploaded file |
| `raw_text` | String? | text content stored at upload time (worker reads this first) |
| `hash` | String? | content hash for dedup (Sprint 2+) |
| `fetched_at` | DateTime? | |
| `parse_status` | ParseStatus | tracks ingestion progress |
| `created_at` | DateTime | |

#### `ingest_jobs`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | returned as `jobId` from `/ingest/upload` |
| `document_id` | UUID UNIQUE FK → documents | cascade delete |
| `stage` | String | default: `"queued"` |
| `status` | JobStatus | |
| `error` | String? | failure message |
| `started_at` | DateTime? | |
| `finished_at` | DateTime? | |
| `created_at` | DateTime | |

#### `incidents`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `document_id` | UUID UNIQUE FK → documents? | nullable for manual ingest |
| `title` | String | |
| `date` | DateTime? | |
| `company` | String? | |
| `products` | String[] | default `[]` |
| `duration` | String? | |
| `severity` | String? | |
| `tags` | String[] | default `[]` |
| `source_url` | String? | |
| `summary_text` | String? | 280-char auto-generated summary |
| `created_at` | DateTime | |

#### `sections`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `incident_id` | UUID FK → incidents | cascade delete; indexed |
| `type` | SectionType | |
| `text` | String | |
| `created_at` | DateTime | |

---

## Planned Schema Additions

### Sprint 2 — Embeddings & Search
- `incidents.summary_embedding` — `vector(1536)` pgvector column
- `sections.embedding` — `vector(1536)` pgvector column
- Full-text search index on `incidents.title` and `sections.text`

### Sprint 3 — Knowledge Graph
- `graph_nodes(id, node_type[Service|Symptom|Trigger|RootCause|Fix|Runbook], name, attrs_json)`
- `graph_edges(id, from_node_id, rel_type[AFFECTS|HAS_SYMPTOM|TRIGGERED_BY|CAUSED_BY|RESOLVED_BY], to_node_id, incident_id, evidence_section_id)`
- `evidence_section_id` is mandatory for graph edges and Q&A citations.

### Sprint 4 — Evaluation & Audit
- `qa_queries(id, question, expected_incident_ids, created_at)`
- `audit_logs(id, action, prompt_version, input_hash, output_hash, created_at)`
