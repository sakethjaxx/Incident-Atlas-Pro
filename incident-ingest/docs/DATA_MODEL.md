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

### Sprint 2 — Embeddings & Search (Frozen)
- `incidents.summary_embedding` — `vector(1536)` pgvector column (Primary: OpenAI `text-embedding-3-small`. Fallback local model `all-MiniLM-L6-v2` pads dimensions or writes to a secondary column).
- `sections.embedding` — `vector(1536)` pgvector column.
- **Evidence Contract:** Searches **must** return matched sections directly as evidence. If a match occurs on the incident summary rather than a specific section, FTS results will highlight FTS text, and Vector results will point to the incident summary.
- **Backfill/Failures:** If embedding generation fails (network loss or missing API keys), ingestion **MUST NOT** fail. Embeddings remain `NULL`. A backfill cron or CLI script will find records where `embedding IS NULL` and retry safely.
- **FTS:** Full-text search index on `incidents.title`, `incidents.summary_text`, and `sections.text`.

### Sprint 3 — Knowledge Graph (Frozen)

**Node Types (Sprint 3):** `service`, `symptom`, `root_cause`, `fix` (others deferred to Sprint 4)
**Rel Types (Sprint 3):** `AFFECTS`, `HAS_SYMPTOM`, `CAUSED_BY`, `RESOLVED_BY`

#### `graph_nodes`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `node_type` | String | Must be one of the Sprint 3 Node Types |
| `name` | String | Lowercase, normalized |
| `attrs_json` | JSON? | |
| `created_at` | DateTime | |
*Constraint:* UNIQUE(`node_type`, `name`) for deduplication.

#### `graph_edges`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `from_node_id` | UUID FK → graph_nodes | |
| `to_node_id` | UUID FK → graph_nodes | |
| `rel_type` | String | Must be one of the Sprint 3 Rel Types |
| `incident_id` | UUID FK → incidents | cascade delete |
| `evidence_section_id` | UUID FK → sections | **MANDATORY** for Sprint 4 Q&A citations |
| `created_at` | DateTime | |

### Sprint 4 - Evaluation & Audit (Frozen)
Frozen for `S4-ARCH-001`. API payloads use camelCase, but database columns remain snake_case.

#### `qa_queries`
Canonical mutable store for evaluation and Q&A regression queries. Checked-in JSON fixtures seed this table for deterministic CI and demo reset.

| Column | Type | Notes |
|--------|------|-------|
| `id` | String PK | Stable slug or UUID; must not change between seed imports. |
| `question` | String | User-facing natural-language query. |
| `expected_incident_ids` | UUID[] | Required for retrieval scoring; empty only for refusal-only QA cases. |
| `expected_section_ids` | UUID[] | Optional citation/evidence target list; default `[]`. |
| `expected_graph_node_ids` | UUID[] | Optional graph-neighbor target list; default `[]`. |
| `query_type` | String | Must be `search`, `graph`, `qa`, or `mixed`. |
| `critical` | Boolean | Critical misses fail CI when expected incidents disappear from Recall@5. |
| `tags` | String[] | Scenario labels such as `rootcause`, `fix`, `refusal`, `prompt_injection`. |
| `query_set_version` | String | Example: `sprint4-seed-v1`; indexed with `critical`. |
| `metadata_json` | JSON? | Non-sensitive notes such as fixture name or expected refusal reason. |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

Recommended indexes:
- `query_set_version`
- `critical`
- GIN on `tags`

#### `eval_runs`
Immutable metadata row for each evaluation run. Per-query details live in the report artifact so CI can publish and diff full JSON without bloating relational tables.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Returned as `runId`. |
| `status` | String | `passed`, `failed`, or `error`. |
| `mode` | String | `fixture` for deterministic CI, `live` for provider-backed release smoke. |
| `query_set_version` | String | Query set used for the run. |
| `git_sha` | String? | Commit SHA when available. |
| `started_at` | DateTime | |
| `finished_at` | DateTime? | Latest report is the newest finished run. |
| `retrieval_config_json` | JSON | Search limits, evidence budget, embedding model, filters. |
| `graph_config_json` | JSON | Graph expansion enabled flag, max depth, evidence-edge checks. |
| `prompt_version` | String? | Example: `qa-v1`; nullable when QA eval is not included. |
| `provider` | String? | Model provider for live Q&A eval runs. |
| `model` | String? | Model name for live Q&A eval runs. |
| `model_version` | String? | Provider version or deployment ID when available. |
| `model_config_json` | JSON? | Non-secret model params such as temperature and max tokens. |
| `thresholds_json` | JSON | Gate thresholds used for pass/fail. |
| `metrics_json` | JSON | Aggregate metrics: Recall@5, Recall@10, MRR, optional NDCG@10, graph/Q&A metrics. |
| `failures_json` | JSON | Sanitized failure summaries, no prompts or secrets. |
| `artifact_path` | String | Path to immutable `eval_report.json`. |
| `created_at` | DateTime | |

`eval_report.json` artifact shape:

```json
{
  "runId": "<uuid>",
  "status": "passed",
  "createdAt": "<iso8601>",
  "querySetVersion": "sprint4-seed-v1",
  "gitSha": "<sha|null>",
  "retrievalConfig": {},
  "graphConfig": {},
  "promptVersion": "qa-v1",
  "models": [],
  "thresholds": {},
  "metrics": {
    "recallAt5": 1.0,
    "recallAt10": 1.0,
    "mrr": 1.0,
    "ndcgAt10": null,
    "zeroResultRate": 0.0,
    "criticalMissCount": 0,
    "graphEvidenceRecallAt5": 1.0,
    "evidenceEdgeCoverage": 1.0,
    "qaCitationPrecision": null,
    "qaGroundedAnswerPassRate": null,
    "qaRefusalAccuracy": null
  },
  "perQuery": [],
  "failures": []
}
```

#### `audit_logs`
Append-only audit trail for prompt-producing routes and admin mutations. The default contract stores hashes, versions, IDs, and counters, not raw sensitive content.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Returned as `auditId` for Q&A responses. |
| `created_at` | DateTime | |
| `request_id` | String? | Correlates app logs and API response. |
| `action` | String | Examples: `qa.answer`, `qa.refuse`, `eval.queries_upsert`, `eval.run`, `ingest.manual`, `source.create`, `scrape.enqueue`. |
| `actor_type` | String | `anonymous`, `qa_token`, `admin_token`, or future role name. |
| `actor_hash` | String? | SHA-256 or HMAC hash of token identity; never raw token. |
| `ip_hash` | String? | Hashed IP for abuse analysis without raw IP storage. |
| `route` | String | API route pattern. |
| `method` | String | HTTP method. |
| `status` | String | `answered`, `refused`, `accepted`, `passed`, `failed`, `error`, etc. |
| `status_code` | Int | HTTP status code. |
| `latency_ms` | Int? | Request duration. |
| `prompt_version` | String? | Prompt contract version, e.g. `qa-v1`. |
| `prompt_template_hash` | String? | Hash of prompt template text. |
| `provider` | String? | Model provider. |
| `model` | String? | Model name. |
| `model_version` | String? | Provider version/deployment when available. |
| `model_config_json` | JSON? | Non-secret params only. |
| `input_hash` | String? | Hash of normalized user input or mutation payload. |
| `output_hash` | String? | Hash of generated answer/refusal/report summary. |
| `retrieved_section_ids` | UUID[] | Evidence section IDs supplied to the model. |
| `retrieved_incident_ids` | UUID[] | Incident IDs represented in retrieved evidence. |
| `refusal_code` | String? | `insufficient_evidence`, `unsupported_scope`, `unsafe_prompt`, or `citation_validation_failed`. |
| `artifact_path` | String? | Eval artifact path when action is `eval.run`. |
| `metadata_json` | JSON? | Non-sensitive counters such as evidence count, token usage, rate-limit bucket. |

Recommended indexes:
- `created_at`
- `action, created_at`
- `request_id`

Never store raw bearer tokens, raw prompts, raw user questions, raw model outputs, provider API keys, stack traces, or full provider payloads in `audit_logs`.
