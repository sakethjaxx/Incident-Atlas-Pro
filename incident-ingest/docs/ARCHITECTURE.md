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
5. **Graph Extraction (Sprint 3):** Worker triggers `extractGraph(sections)` pipeline after embedding.
   - *Contract:* Input is `[{ type, text }]`. Output is `{ nodes: [{ name, type }], edges: [{ from_name, to_name, rel_type, evidence_section_id }] }`.
   - *Pipeline:* Hybrid approach. Primary: Deterministic rule-based extractor. Model-backed option: `qwen3:4b` via Ollama. No Anthropic/OpenAI used in live config (see `OPEN_SOURCE_RAG_STACK.md`).
   - *Failure state:* Graph extraction failure does NOT block ingestion. Unsuccessful graphs leave no rows and will be resolved by a background keyset-paginated backfill.
   - *UI Library:* `react-force-graph-2d` used to visualize `GET /graph/neighbors` queries.
6. **Retrieval:** `GET /search` runs query embedding, merging Vector + FTS, mapping vector distances to scores, and returning Section-level text as Evidence.

## Sprint 4 Quality, Q&A, Auth, and Audit Contracts

### Evaluation Flow
1. Checked-in JSON fixtures seed `qa_queries`; the database is the runtime source of truth.
2. `POST /eval/queries` upserts a named query set and validates stable IDs, expected incident IDs, query type, critical flag, and tags.
3. `POST /eval/run` executes a small synchronous run against live app retrieval or deterministic fixtures.
4. The runner computes Recall@5, Recall@10, MRR, optional NDCG@10, zero-result rate, critical miss count, graph evidence recall, evidence edge coverage, Q&A citation precision, grounded answer pass rate, and refusal accuracy when those modes are enabled.
5. Each run writes an immutable `eval_runs` row plus `artifacts/eval/<runId>/eval_report.json`.
6. `GET /eval/latest` returns the newest finished report summary and artifact path.

Sprint 4 gates:
- Fail if any critical query loses all expected incidents from Recall@5.
- Fail if Recall@5 or MRR drops by more than 5 percentage points from the configured baseline.
- Fail if any returned graph edge lacks `evidence_section_id`.
- Fail if an answerable Q&A response has uncited factual claims or citations outside retrieved evidence.
- Fail if seeded refusal or prompt-injection questions return `status: "answered"`.
- Use fixture mode for CI. Live mode is for release smoke when provider credentials are present.

### Citations-First Q&A Flow
1. Authenticate and rate-limit before retrieval.
2. Validate the question: non-empty, max 1000 chars, no silent intent rewrite.
3. Retrieve candidate sections through the existing hybrid search path.
4. Use graph expansion only to discover more evidence sections. A graph edge can add its `evidence_section_id`; graph text itself never enters the answer as an unsupported source.
5. Dedupe sections by `section.id`, cap the default evidence packet at 8 sections, and cap citation excerpts at 320 chars.
6. Run a sufficiency gate:
   - no retrieved sections -> refuse
   - comparison question with fewer than two relevant incidents -> refuse
   - root-cause/fix question without matching section or graph evidence -> refuse
   - prompt-injection attempt in user text or retrieved text -> refuse
7. Generate with `promptVersion: qa-v1`; all factual sentences must carry citation labels such as `[C1]`.
8. Post-validate citations. If any answer sentence is uncited or cites a section outside the retrieved packet, return `status: "refused"` with `reasonCode: "citation_validation_failed"`.
9. Write `audit_logs` for both answer and refusal paths.

### Prompt and Model Versioning
- The first Q&A prompt version is `qa-v1`.
- Eval reports include `promptVersion` when Q&A scoring is enabled.
- API responses expose non-secret model metadata: provider, model name, optional version/deployment, and prompt version.
- Audit logs store `prompt_template_hash`, `input_hash`, and `output_hash`; raw prompts, raw questions, raw outputs, tokens, stack traces, and provider payloads are not persisted by default.

### Auth and Rate Limits
- Production admin mutation routes require `ADMIN_TOKEN`.
- Production Q&A accepts `QA_TOKEN` or `ADMIN_TOKEN`.
- Local unauthenticated Q&A is allowed only when neither token env var is configured.
- Read routes stay public for the MVP demo unless `READ_TOKEN_REQUIRED=true`.
- Route-specific rate limits are frozen in `docs/API_SPEC.md`; implementations should keep limits configurable by env while preserving the documented defaults.
- Standard auth/rate-limit errors are intentionally plain: `401 Unauthorized`, `403 Forbidden`, and `429 Rate limit exceeded` with `retryAfterSeconds`.

### Sprint 4 Release Gates
Release integration cannot mark Sprint 4 complete until the smoke path proves:
1. Migrations apply from scratch.
2. Postgres, Redis, API `/health`, and worker queue readiness pass.
3. Seeded or uploaded demo incident ingest completes.
4. `/search` returns expected section evidence.
5. `/graph/patterns` and `/graph/neighbors` return graph evidence with `evidence_section_id` on every edge.
6. `POST /qa` answers an in-corpus question with at least one citation whose anchor resolves to `#section-{sectionType}-{sectionId}`.
7. `POST /qa` refuses an unsupported question.
8. `POST /eval/run` in fixture mode completes, and `GET /eval/latest` returns the same report summary and artifact path.
9. Protected routes return `401` without valid tokens when production token env vars are set.
10. A documented rate-limit spot check returns `429` without leaking internal details.

### Implementation Notes For Builders
- `W4-001` should implement the eval endpoints, seed import path, metric functions, immutable report artifact, and fixture CI gate first.
- `W4-002` should reuse the search evidence contract and existing section anchors. Keep generated answers short and refuse aggressively when evidence is thin.
- `W4-003` should centralize bearer-token checks, route-group rate limits, sanitized errors, and audit-log helpers so Q&A and eval code do not duplicate guard logic.
- `W4-004` should render citations as first-class evidence cards and treat refusal, unauthorized, and rate-limited states as normal UI states.
- `W4-005` should make the release smoke deterministic with seeded fixtures; live provider calls can be optional release evidence, not a CI blocker.
