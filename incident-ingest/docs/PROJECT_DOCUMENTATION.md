# Incident Atlas Pro - Project Documentation

> Current state: Sprint 1 through Sprint 4 are implemented and technically demo-ready.
> Last consolidation verified: 2026-05-17.

## 1. Executive Summary

Incident Atlas Pro is an incident-intelligence system. It takes raw outage notes, postmortems, incident reports, or manually entered incident text and turns that data into searchable, evidence-backed operational knowledge.

The project is trying to answer questions that engineering and reliability teams repeatedly face:

- Have we seen this failure pattern before?
- Which incidents were similar to the current one?
- What symptoms usually appeared with this service or root cause?
- What fixes worked before?
- Can we answer an incident question with exact evidence instead of guessing?

The current version is a strong technical demo. It supports ingestion, async worker processing, section parsing, hybrid search, similar incident discovery, knowledge graph extraction, citations-first Q&A, evaluation runs, route-specific rate limits, and audit logging.

It is not yet a production enterprise product. The core workflow works, but a company deployment would need stronger source connectors, access control, data governance, observability, seeded demo data, and production operations work.

## 2. Where The Project Stands

### Current Project Status

The project is currently past Sprint 4.

Completed:

- Sprint 1: base schema, ingestion, async processing, worker, and web UI foundations.
- Sprint 2: hybrid search, embeddings, similar incident API, and retrieval UI.
- Sprint 3: knowledge graph schema, graph extraction, graph APIs, graph UI, and evidence-backed graph edges.
- Sprint 4: evaluation harness, citations-first Q&A, auth/rate-limit hardening, audit logs, and release smoke checks.

The repo was stabilized before Sprint 5:

- Task board contradictions were fixed.
- Generated eval artifacts are ignored.
- Sprint 3 and Sprint 4 work was consolidated into a clean commit.
- Docker Postgres and Redis were brought up.
- Migrations were applied.
- Full API integration tests passed.
- Release smoke test passed.

Verification evidence from the consolidation pass:

```text
pnpm run api:migrate
No pending migrations to apply.

pnpm --filter @app/api test:integration
153 passed / 0 failed.

scripts/smoke-test.sh
Sprint 4 Smoke Test SUCCESS.
```

### Current Demo Readiness

The project is demo-ready as a controlled technical demo.

Ready to show:

- Upload or manually ingest incident text.
- Parse incident text into typed sections.
- Search incidents by query.
- Find similar incidents.
- Extract graph nodes and edges from incidents.
- Explore graph patterns and graph neighbors.
- Ask Q&A questions that answer with citations.
- Refuse unsupported or unsafe Q&A questions.
- Run evaluation and retrieve latest eval reports when seeded.
- Show route guards, rate limits, and audit logging patterns.

Needs more polish before a public product-style demo:

- Clean seeded demo database.
- Better sample incident corpus.
- A scripted 5-10 minute demo path.
- Stronger visual polish for graph exploration and Q&A.
- Better production deployment story.
- Better source connectors beyond manual/file upload.

## 3. What We Are Building

Incident Atlas Pro is not just a document upload app. The goal is to build an incident memory layer.

The system currently has five major capabilities:

1. Ingestion
   - Accept incident text through single-file upload, batch upload, or manual entry.
   - Store raw document content.
   - Process text into incident records and sections.

2. Retrieval
   - Search across incidents and sections.
   - Use section-level evidence instead of only document-level matches.
   - Support similar incident discovery.

3. Knowledge Graph
   - Extract structured nodes such as services, symptoms, root causes, and fixes.
   - Connect nodes with evidence-backed relationships.
   - Let users see recurring patterns across incidents.

4. Citations-First Q&A
   - Retrieve evidence before answering.
   - Generate extractive answers from retrieved sections.
   - Attach citation labels and deep links to exact incident sections.
   - Refuse when evidence is insufficient or unsafe.

5. Evaluation And Release Confidence
   - Store eval query sets.
   - Run retrieval and graph quality checks.
   - Save immutable eval artifacts.
   - Use smoke tests to verify the full release path.

## 4. Why This Project Matters

Incident knowledge often exists, but it is scattered:

- Postmortems in docs.
- Incident notes in Slack.
- Status page updates.
- Runbooks in separate tools.
- Root cause summaries in ticketing systems.
- Tribal knowledge in engineers' heads.

That creates repeated pain:

- Teams repeat old debugging work.
- Fixes from previous incidents are hard to find.
- Similar failures are missed.
- Postmortems are written but underused.
- AI answers can hallucinate if they are not grounded in evidence.

Incident Atlas Pro addresses this by turning unstructured incident text into structured, searchable, evidence-linked knowledge.

The product principle is:

> If the system cannot cite the incident evidence, it should not answer confidently.

That principle shaped the graph, Q&A, and evaluation design.

## 5. Current Architecture

### Application Stack

Current implementation:

- Frontend: Vite + React 18
- Backend: Node.js + Express
- Database: PostgreSQL with Prisma ORM
- Vector search: pgvector columns inside PostgreSQL
- Queue: BullMQ
- Queue backend: Redis
- Worker: Node.js worker process
- NLP package: local workspace package `@pkg/nlp`
- Local dev orchestration: Docker Compose

### Main Packages

```text
incident-ingest/
  apps/
    api/       Express API, Prisma schema, routes, tests
    web/       React app
    worker/    BullMQ worker for async parsing/indexing
  packages/
    nlp/       section parsing, summarization, embeddings, graph extraction
  docs/        architecture, API, data model, sprint plans, runbooks
  scripts/     smoke tests and release scripts
```

### Why This Architecture

Express API:

- Fast to iterate.
- Easy route testing with Vitest and Supertest.
- Fits the JavaScript monorepo.

PostgreSQL:

- Stores source documents, incidents, sections, jobs, graph rows, audit logs, and eval data in one database.
- Keeps the MVP operationally simple.

pgvector:

- Adds vector search without introducing a separate vector database yet.
- Good fit for an MVP with moderate data volume.

BullMQ + Redis:

- Uploads should not block on parsing, embeddings, and graph extraction.
- Job status can be polled by the UI.
- Worker failure/retry behavior is isolated from request handling.

Section-level evidence:

- Search and Q&A are more useful when they point to exact evidence sections.
- This enables citations and deep links.

Knowledge graph in Postgres:

- A simple graph table design is enough for Sprint 3.
- Avoids bringing in Neo4j too early.
- Can be migrated later if graph traversal needs become more complex.

Local deterministic embeddings:

- The current implementation can run without external AI provider credentials.
- This makes tests and demos reproducible.
- The DB contract still uses 1536-dimensional vectors, so provider-backed embeddings can be swapped in later.

## 6. Data Model Overview

The main entities are:

### `sources`

Represents where incident data came from.

Examples:

- Manual upload
- Blog
- Status page
- GitHub
- PDF
- Future company connectors

Why it exists:

- Companies need provenance.
- Users should know where an incident came from.
- Future scheduled source sync depends on this model.

### `documents`

Stores raw uploaded/fetched content before parsing.

Important fields:

- `raw_text`
- `raw_path`
- `hash`
- `parse_status`
- `source_id`

Why it exists:

- Keeps raw input separate from parsed incident output.
- Enables retry and reprocessing.
- Enables deduplication by content hash.

### `ingest_jobs`

Tracks async parsing jobs.

Important fields:

- `document_id`
- `status`
- `stage`
- `error`
- `started_at`
- `finished_at`

Why it exists:

- The UI can poll job progress.
- Failed processing is visible.
- Worker processing is observable.

### `incidents`

The normalized incident record.

Important fields:

- `title`
- `company`
- `date`
- `severity`
- `tags`
- `summary_text`
- `summary_embedding`

Why it exists:

- This is the main searchable incident object.
- It connects raw documents, parsed sections, graph edges, and retrieval results.

### `sections`

Typed evidence chunks from an incident.

Current section types:

- `impact`
- `timeline`
- `rootcause`
- `fix`

Why it exists:

- Q&A needs precise citations.
- Search results are more useful when they return exact evidence.
- Graph extraction needs structured inputs.

### `graph_nodes`

Deduplicated extracted entities.

Current node types:

- `service`
- `symptom`
- `root_cause`
- `fix`

Why it exists:

- Lets the system find recurring concepts across incidents.
- Example: many incidents can point to the same `payment-api` service node.

### `graph_edges`

Evidence-backed relationships between graph nodes.

Current relationship types:

- `AFFECTS`
- `HAS_SYMPTOM`
- `CAUSED_BY`
- `RESOLVED_BY`

Important rule:

- Every graph edge must have `evidence_section_id`.

Why it exists:

- A graph relationship is only useful if it can point back to evidence.
- Q&A can use graph edges to discover relevant sections.

### `qa_queries`

Stores evaluation queries.

Why it exists:

- Retrieval and Q&A need regression tests.
- A company needs to know whether search quality is improving or breaking.

### `eval_runs`

Stores immutable evaluation results.

Why it exists:

- Release quality should be measurable.
- The latest eval report can be shown in UI and used as release evidence.

### `audit_logs`

Stores hashed metadata about sensitive actions.

Why it exists:

- Q&A and eval actions should be traceable.
- Admin mutations should be auditable.
- Raw prompts, raw tokens, and secrets should not be stored.

## 7. How Ingestion Works Today

The project currently supports three ingestion paths.

### Path A: Multipart File Upload

Endpoint:

```text
POST /ingest/upload
```

Purpose:

- This is the main async upload path for the web UI.

Input:

- Multipart form field: `file` for legacy single-file uploads
- Multipart form field: `files` for batch uploads
- Default batch limit: 20 files per request (`MAX_UPLOAD_FILES`)
- Size limit: 10 MB per file
- Best-supported file types today: `.txt` and `.md`
- PDF is detected and fails clearly because PDF extraction is not implemented yet.

Flow:

1. API receives one or more uploaded files.
2. Auth and rate limits are applied.
3. Each file is stored locally under the upload directory.
4. For text/markdown files, API reads content into `document.rawText`.
5. For each file, API creates:
   - `documents` row
   - `ingest_jobs` row
6. API enqueues one BullMQ job per document.
7. API returns:

```json
{
  "accepted": 2,
  "uploads": [
    {
      "fileName": "incident-a.txt",
      "jobId": "<uuid>",
      "documentId": "<uuid>",
      "bullmqJobId": "<string>",
      "pollUrl": "/jobs/<uuid>"
    },
    {
      "fileName": "incident-b.md",
      "jobId": "<uuid>",
      "documentId": "<uuid>",
      "bullmqJobId": "<string>",
      "pollUrl": "/jobs/<uuid>"
    }
  ],
  "jobId": "<uuid>",
  "documentId": "<uuid>"
}
```

The top-level `jobId` and `documentId` are included only for single-file compatibility.

8. UI polls:

```text
GET /jobs/:jobId
```

9. Worker processes the job in the background.

Why async upload matters:

- Real incident documents may be large.
- Parsing, embeddings, and graph extraction can take time.
- The API should remain responsive.
- The UI can show progress instead of freezing.

### Path B: Manual JSON Ingest

Endpoint:

```text
POST /ingest/manual
```

Purpose:

- This is the fast synchronous path for demos, tests, and manually entered incident text.

Input example:

```json
{
  "title": "Payments outage",
  "company": "ExampleCo",
  "date": "2026-01-28T10:30:00Z",
  "severity": "SEV2",
  "tags": ["payments", "checkout"],
  "rawText": "Impact:\nCheckout failed for 32 minutes.\n\nRoot Cause:\nBad deploy to payment-service.\n\nFix:\nRolled back the deploy."
}
```

Flow:

1. API validates required fields.
2. API parses `rawText` into typed sections.
3. API summarizes the text.
4. API creates the incident and sections in one request.
5. API indexes embeddings.
6. API runs graph extraction.
7. API returns the full incident object.

Why this path exists:

- It is simple for demos.
- It is easy to test.
- It bypasses queue timing when immediate feedback is useful.

### Path C: Document Upload Plus Explicit Enqueue

Endpoints:

```text
POST /documents/upload
POST /ingest/:documentId
```

Purpose:

- This is a lower-level API path.
- It creates a document and job first, then lets the caller enqueue processing separately.

Flow:

1. `POST /documents/upload` creates a document row with `rawText`.
2. It also creates an `ingest_jobs` row.
3. `POST /ingest/:documentId` enqueues that document for worker processing.
4. Worker creates the incident and sections.

Why this path exists:

- It separates document creation from processing.
- Future source connectors can use this style.
- It is useful when ingestion needs staging or review before processing.

## 8. Worker Processing Pipeline

The worker is responsible for async parsing and indexing.

Input:

```json
{
  "documentId": "<uuid>"
}
```

Stages:

1. Fetch
   - Load the document from Postgres.
   - Resolve text from `rawText` first.
   - If `rawText` is empty, try `rawPath`.

2. Parse
   - Call `parseSections(rawText)`.
   - Call `summarize(rawText)`.

3. Persist
   - Create `incident`.
   - Create `sections`.

4. Index Retrieval
   - Generate deterministic local embeddings.
   - Store incident and section vectors.

5. Index Graph
   - Extract graph nodes and edges.
   - Upsert graph nodes.
   - Insert evidence-backed graph edges.

6. Complete
   - Mark `document.parseStatus = done`.
   - Mark `ingestJob.status = success`.
   - Return `{ incidentId, error: null }`.

Failure behavior:

- Permanent errors are recorded and not retried.
- Transient errors can be retried by BullMQ.
- Embedding failures do not block ingestion.
- Graph extraction failures do not block ingestion.

Why this matters:

- Ingestion should be resilient.
- A failure in an enrichment layer should not erase the base incident.
- Missing embeddings or graph rows can be backfilled later.

## 9. Section Parsing And Summarization

The NLP package identifies four section types:

- Impact
- Timeline
- Root cause
- Fix

The parser recognizes headings and aliases such as:

- `Root Cause`
- `RCA`
- `Mitigation`
- `Remediation`
- `Corrective Action`
- `Customer Impact`

Why sections matter:

- They make retrieval more precise.
- They support Q&A citations.
- They give graph extraction cleaner inputs.
- They let users jump directly to the evidence on incident detail pages.

## 10. Retrieval And Similarity

### Search

Endpoint:

```text
GET /search?q=<query>
```

What it does:

- Searches incident title, summary, company, and section text.
- Uses Postgres full-text search.
- Uses pgvector if embeddings exist.
- Falls back to local scoring if vector query fails.
- Returns section-level evidence.

Why hybrid retrieval:

- Keyword search is strong for exact service names and error phrases.
- Vector similarity helps when wording is different but meaning is similar.
- Combining both makes the product more useful for incident memory.

### Chunk-Level Retrieval (Sprint 5)

Q&A evidence now comes from a dedicated `chunks` index instead of whole
sections, while `/search` keeps its frozen incident-level contract:

- Each section produces one `section` chunk, plus `paragraph` chunks
  (~700 chars with 80-char overlap) when the section is long.
- Every chunk carries exact citation anchors (`incident_id` + `section_id`)
  and denormalized metadata (company, severity, tags, products) so retrieval
  filters before scoring.
- Pipeline: metadata filters → Postgres FTS (top 50) → vector backend
  (top 50) → Reciprocal Rank Fusion (k=60) → optional rerank (top 40) →
  5–8 evidence chunks.
- Vector backend is switchable: `RETRIEVAL_BACKEND=pgvector` (stable baseline,
  HNSW index), `turboquant` (experimental compressed scan, see
  `docs/TURBOQUANT_RAG_PLAN.md`), or `hybrid` (both fused).
- Embeddings are provider-driven (`EMBEDDING_PROVIDER=local|bge|ollama`,
  open-source models only) and stored zero-padded in fixed `vector(1536)`
  columns. See `docs/OPEN_SOURCE_RAG_STACK.md`.
- Debug traces (per-backend rank/score, fused score, rerank score) are exposed
  via `POST /qa` eval mode and `GET /search?debug=1`.
- If the chunk index is empty (pre-migration data), Q&A transparently falls
  back to the legacy section-level retrieval; `pnpm reindex:chunks` backfills.

### Similar Incidents

Endpoint:

```text
GET /incidents/:id/similar
```

What it does:

- Finds incidents with similar summaries and sections.
- Returns score, reason, and matched sections.

Why similar incidents matter:

- During an active incident, engineers often ask "have we seen this before?"
- This endpoint is the direct answer to that workflow.

## 11. Knowledge Graph

### What The Graph Represents

The graph extracts recurring incident concepts:

- Service: `payment-api`
- Symptom: `elevated error rate`
- Root cause: `bad deploy to payment-api connection pool`
- Fix: `rolling back the deploy`

It connects these with relationships:

- `AFFECTS`
- `HAS_SYMPTOM`
- `CAUSED_BY`
- `RESOLVED_BY`

Example:

```text
payment-api --AFFECTS--> elevated error rate
payment-api --CAUSED_BY--> bad deploy to payment-api connection pool
bad deploy to payment-api connection pool --RESOLVED_BY--> rolling back the deploy
```

### Why The Graph Exists

Search answers "find documents like this."

The graph answers "what patterns keep recurring?"

Graph use cases:

- Show common symptoms for a service.
- Show root causes that frequently appear together.
- Show fixes attached to specific types of failures.
- Help Q&A discover evidence sections beyond first-pass search.

### Graph Extraction

Current extraction strategy:

- Primary design: LLM extraction if provider credentials are available.
- Current reliable path: deterministic rule-based fallback.
- Validation drops invalid nodes and edges.
- Every edge must reference a real `evidence_section_id`.

Why this was hard:

- Graph extraction can easily hallucinate entities.
- Bad graph nodes pollute the product.
- The system needs high precision more than high recall at this stage.

The current fallback intentionally extracts conservatively.

### Graph APIs

Graph patterns:

```text
GET /graph/patterns?service=payment-api
```

Returns recurring graph clusters and incident counts.

Graph neighbors:

```text
GET /graph/neighbors?node_id=<uuid>&depth=1
```

Returns connected nodes and edges.

Depth is capped at `2`.

Why the cap exists:

- Prevents expensive graph traversals.
- Keeps demo responses readable.
- Reduces risk of runaway queries.

## 12. Citations-First Q&A

Endpoint:

```text
POST /qa
```

Input example:

```json
{
  "question": "What caused the checkout outage?",
  "filters": {
    "company": "payment-api"
  },
  "options": {
    "maxEvidenceSections": 8,
    "includeGraphContext": true,
    "mode": "answer"
  }
}
```

Response shape:

```json
{
  "status": "answered",
  "answer": "Root cause was bad deploy to payment-api connection pool [C1].",
  "citations": [
    {
      "label": "C1",
      "incidentId": "<uuid>",
      "sectionId": "<uuid>",
      "sectionType": "rootcause",
      "title": "payment-api checkout outage",
      "excerpt": "Root cause was bad deploy to payment-api connection pool.",
      "anchor": "#section-rootcause-<sectionId>",
      "retrievalScore": 0.35
    }
  ],
  "refusal": null,
  "evidenceCount": 3,
  "confidence": 0.3093,
  "promptVersion": "qa-v1",
  "model": {
    "provider": "local",
    "name": "extractive-citation-v1"
  },
  "auditId": "<uuid>"
}
```

Refusal shape:

```json
{
  "status": "refused",
  "answer": null,
  "citations": [],
  "refusal": {
    "reasonCode": "insufficient_evidence",
    "message": "I do not have enough cited incident evidence to answer that."
  }
}
```

### How Q&A Works

1. Validate the question.
2. Reject unsafe prompt-injection style input.
3. Run search to retrieve candidate evidence sections.
4. Optionally expand with graph evidence.
5. Dedupe and rank evidence sections.
6. Check sufficiency.
7. Build a short extractive answer.
8. Attach citation labels.
9. Validate that every answer sentence has citations.
10. Write audit log metadata.

### Why Q&A Is Extractive Today

The current Q&A model is local and extractive. It builds answers from retrieved evidence sections rather than freely generating from a frontier model.

Why this is good for the current stage:

- No external provider dependency.
- Safer demo behavior.
- Easy to test.
- Harder to hallucinate.
- Citation validation is straightforward.

What can improve later:

- Add provider-backed answer generation.
- Keep the same evidence packet and citation rules.
- Use stronger groundedness validation.
- Support multi-step comparative answers.

## 13. Evaluation Harness

Endpoints:

```text
POST /eval/queries
POST /eval/run
GET /eval/latest
```

Purpose:

- Store eval questions.
- Run retrieval and graph quality checks.
- Save reports.
- Show latest eval state in the UI.

Metrics include:

- Recall@5
- Recall@10
- MRR
- NDCG@10
- Zero-result rate
- Critical miss count
- Graph evidence recall
- Evidence edge coverage
- Q&A citation precision when enabled

Why eval matters:

- Search quality can regress silently.
- Graph extraction can lose evidence links.
- Q&A can become less grounded if retrieval changes.
- Companies need quality gates before deployment.

## 14. Auth, Rate Limits, And Audit Logging

### Auth

Current auth is bearer-token based.

Environment variables:

- `ADMIN_TOKEN`
- `QA_TOKEN`
- `READ_TOKEN_REQUIRED`

Behavior:

- Admin routes require `ADMIN_TOKEN` when configured.
- Q&A accepts `QA_TOKEN` or `ADMIN_TOKEN`.
- Read routes are public for local/demo unless `READ_TOKEN_REQUIRED=true`.

Why this exists:

- It is enough for MVP demo hardening.
- It proves route boundaries.
- It gives a path toward stronger enterprise auth.

### Rate Limits

Current default limits:

- Public reads: 60/min/IP
- Jobs: 60/min/IP
- Admin ingest: 10/min/token or IP
- Eval query mutation: 5/min
- Eval run: 3/hour
- Eval latest: 30/min/IP
- Q&A: 10/min/token or IP

Why rate limits matter:

- Q&A and eval can be expensive.
- Ingest can stress the worker and database.
- Companies need abuse and accident protection.

### Audit Logs

Audit logs store:

- Action
- Route
- Status
- Latency
- Prompt version
- Model metadata
- Input and output hashes
- Retrieved section IDs
- Retrieved incident IDs
- Refusal code

Audit logs do not store:

- Raw bearer tokens
- Raw prompts
- Provider API keys
- Stack traces
- Full provider payloads

Why this matters:

- Companies need traceability.
- Users need accountability for AI-assisted answers.
- Sensitive incident content should not be duplicated unnecessarily.

## 15. Frontend Experience

Current web routes:

- `/` Dashboard
- `/search` Search UI
- `/incidents` Incident list
- `/incidents/:id` Incident detail with sections
- `/graph` Knowledge graph explorer
- `/qa` Citations-first Q&A
- `/eval` Evaluation report view
- `/upload` Manual/file upload flow

What the UI demonstrates:

- API health status.
- Upload and job status flow.
- Incident browsing.
- Section evidence.
- Graph exploration.
- Q&A citations and refusals.
- Eval visibility.

What should improve:

- More polished graph visualization.
- Better empty states for new deployments.
- Cleaner seeded demo data.
- Admin source management.
- Source health dashboard.
- Human feedback on Q&A answers.

## 16. What We Have Overcome So Far

### 1. Moving from raw text to structured incidents

The system now turns messy incident notes into typed sections, summaries, searchable incident records, and evidence blocks.

### 2. Keeping ingestion resilient

Embeddings and graph extraction can fail without destroying the base incident. That is important because enrichment layers are usually less reliable than core persistence.

### 3. Avoiding ungrounded Q&A

The project chose a citations-first design. This avoids the trap of building a chatbot that sounds useful but cannot prove its claims.

### 4. Making graph edges evidence-backed

Every graph edge requires `evidence_section_id`. This is a strong design choice because it keeps the graph accountable.

### 5. Stabilizing the repo

Sprint 3 and Sprint 4 produced a lot of work. The repo had to be consolidated, the task board corrected, generated artifacts ignored, Docker brought up, migrations verified, API tests run, and smoke checks fixed.

### 6. Aligning smoke tests with shipped API behavior

The Q&A API returns `status: "answered"` for successful answers. The smoke script originally expected older status values. The script was updated to match the shipped contract and require citations on answered responses.

## 17. Current Limitations

### Ingestion limitations

- No real production connectors yet.
- PDF extraction is not implemented.
- No HTML/blog/status-page scraper yet.
- No scheduled source sync yet.
- Batch upload exists, but large corpus imports are not resumable yet.
- No mature deduplication beyond content hash foundations.
- Upload storage is local, not S3 or object storage.

### Retrieval limitations

- Embeddings are local deterministic vectors, not provider-quality semantic embeddings.
- Eval dataset is small.
- Search ranking is useful for demo, but not tuned on a large incident corpus.

### Graph limitations

- Rule extraction is conservative.
- LLM graph extraction path needs production provider integration and stronger validation.
- Graph is stored in Postgres, which is fine for MVP but may need specialized graph tooling later.

### Q&A limitations

- Answers are extractive and short.
- Multi-hop reasoning is limited.
- Comparative questions need more corpus depth.
- There is no user feedback loop yet.

### Enterprise limitations

- No SSO.
- No RBAC.
- No multi-tenant isolation.
- No enterprise secrets management.
- No full observability stack.
- No retention policy.
- No permission-aware retrieval.

## 18. If Implementing This For Companies

To make this useful in a real company, the next improvements should focus on trust, integration, access control, and operations.

### A. Source Connectors

Companies will not manually upload every postmortem.

Needed connectors:

- Confluence
- Google Docs
- Notion
- Slack incident channels
- Jira
- Linear
- GitHub issues and pull requests
- PagerDuty
- Opsgenie
- Statuspage
- Datadog incident notes
- S3 or shared document buckets

Why:

- Incident knowledge lives across tools.
- The product becomes valuable only when it continuously ingests real sources.

Recommended design:

- Create a connector framework.
- Each connector implements:
  - authenticate
  - fetch
  - normalize
  - dedupe
  - schedule
  - retry
  - report health

### B. Better Document Processing

Needed:

- PDF extraction.
- HTML article extraction.
- Markdown cleanup.
- Slack thread reconstruction.
- Attachment processing.
- Boilerplate removal.
- PII/secrets detection before storage.

Why:

- Real incident data is messy.
- Better parsing improves search, graph, and Q&A quality.

### C. Permission-Aware Retrieval

Needed:

- User identity.
- Team membership.
- Source permissions.
- Row-level or application-level access filtering.
- Permission-aware search and Q&A.

Why:

- Companies have sensitive incidents.
- Users should only retrieve and ask questions over data they are allowed to see.

### D. Enterprise Authentication

Needed:

- SSO with OIDC or SAML.
- Role-based access control.
- Admin roles.
- Audit viewer roles.
- Read-only users.
- Service accounts for connectors.

Why:

- Bearer tokens are acceptable for MVP but not enough for enterprise usage.

### E. Stronger AI Provider Layer

Shipped in Sprint 5 (open-source only — no Anthropic, no OpenAI):

- Provider abstraction for embeddings (`EMBEDDING_PROVIDER=local|bge|ollama`,
  default models `BAAI/bge-small-en-v1.5` / `bge-m3`).
- Provider abstraction for Q&A generation (`QA_PROVIDER=local|ollama`,
  Qwen3-4B-Instruct via Ollama) and graph extraction (`GRAPH_EXTRACTOR=rules|ollama`).
- Reranker interface (`RERANKER_PROVIDER=none|local|bge` with
  `BAAI/bge-reranker-base` over a TEI endpoint).
- Configurable model names, timeouts (`OLLAMA_TIMEOUT_MS`), prompt versions
  (`qa-v1`, `qa-v2-ollama`), and post-generation citation validation.
- See `docs/OPEN_SOURCE_RAG_STACK.md`.

Still needed:

- Retry policy beyond single-attempt + fallback.
- Cost/compute tracking dashboards.
- A formal prompt version registry.

Why:

- The product runs on free, self-hosted open models by design; the same
  abstraction keeps it from ever being locked to one provider.

### F. Evaluation And Feedback Loop

Needed:

- Larger golden eval set.
- Per-company eval queries.
- User feedback on answers.
- "Was this citation useful?" feedback.
- Human correction workflow.
- Regression dashboards.

Why:

- Retrieval quality is not static.
- Company data changes.
- The system needs continuous measurement.

### G. Production Observability

Needed:

- Structured logs.
- Metrics.
- Traces.
- Queue dashboard.
- Connector health.
- Slow query monitoring.
- Error budgets.
- Alerting.

Why:

- The product itself becomes reliability infrastructure.
- It must be observable.

### H. Deployment And Operations

Needed:

- Production Docker images.
- Kubernetes or managed container deployment.
- Managed Postgres.
- Managed Redis.
- Object storage.
- Database backups.
- Migration strategy.
- Disaster recovery.
- Environment-specific config.

Why:

- A local demo stack is not enough for company data.

### I. Data Governance

Needed:

- Retention policies.
- Redaction policies.
- Encryption at rest.
- Encryption in transit.
- Audit export.
- Tenant isolation.
- Legal hold support for incident records.

Why:

- Incident reports often contain customer impact, internal systems, and sensitive operational details.

### J. Product UX For Teams

Needed:

- Source health dashboard.
- Ingest failure queue.
- Incident curation UI.
- Merge duplicate incidents.
- Edit section labels.
- Correct graph nodes and relationships.
- Save useful Q&A answers.
- Export evidence packets.
- Incident pattern dashboards.

Why:

- Companies need workflows, not just APIs.
- Human correction will improve quality over time.

## 19. Recommended Sprint 5 Direction

Sprint 5 should focus on production data expansion and reliability.

Recommended Sprint 5 theme:

> Turn the technical demo into a continuously fed incident intelligence system.

Suggested Sprint 5 tickets:

1. S5-PLAN-001: Sprint 5 plan and ticket routing
2. S5-RES-001: Source connector and enterprise ingestion research
3. S5-ARCH-001: Source connector contract and provenance model
4. W5-001: Connector framework
5. W5-002: Scheduled ingest and dedupe
6. W5-003: Source provenance and trust UI
7. W5-004: Admin operations dashboard
8. W5-005: Demo data reset and seeded demo flow
9. Sprint5-Release: production-style smoke and docs

Why this is the right next step:

- The intelligence layer exists.
- The next bottleneck is real, clean, continuously updated incident data.
- A better demo needs a stronger corpus and cleaner operational flow.

## 20. Demo Plan

Recommended 10-minute demo:

1. Start with the problem
   - Incident knowledge is scattered and hard to reuse.

2. Upload or manually ingest an incident
   - Show raw incident text.
   - Show job completion or synchronous ingest.

3. Show incident sections
   - Explain impact, timeline, root cause, and fix sections.

4. Search
   - Search for a symptom or service.
   - Show section-level evidence.

5. Similar incidents
   - Open one incident.
   - Show similar incidents and reasons.

6. Graph
   - Search graph patterns for a service.
   - Open neighbors.
   - Show evidence-backed edges.

7. Q&A
   - Ask "What caused the checkout outage?"
   - Show cited answer.
   - Click citation anchor.

8. Refusal
   - Ask an unsupported question.
   - Show refusal.

9. Eval
   - Show latest eval page if seeded.
   - Explain quality gates.

10. Close
   - Explain what Sprint 5 improves for company readiness.

## 21. Summary

Incident Atlas Pro currently has the foundation of a useful incident intelligence platform:

- It can ingest incident text.
- It can parse and store evidence sections.
- It can search and compare incidents.
- It can extract graph patterns.
- It can answer questions with citations.
- It can refuse unsupported questions.
- It can run quality checks.
- It has basic auth, rate limits, audit logs, and smoke tests.

The most important design decision is evidence-first behavior. Search, graph, and Q&A all point back to exact incident sections. That makes the system more trustworthy than a generic chatbot over documents.

The next stage is company readiness: connectors, permissions, production operations, stronger evals, and a polished demo corpus.
