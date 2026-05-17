# API Spec

> **Last updated:** 2026-05-13
> **Sprint 3 status:** All graph extraction and query endpoints shipped, QA-approved, and smoke-tested.
> **Sprint 4 status:** All evaluation, citations-first Q&A, auth/rate limits, and audit logs shipped and verified.

---

## Sprint 1 — Shipped Endpoints

### Liveness

```
GET /health
→ 200 { ok: true, ts: "<iso8601>" }
```

### Ingestion

```
POST /ingest/upload
  Content-Type: multipart/form-data
  Authorization: Bearer <token>   (required when ADMIN_TOKEN set; omit in dev)
  Body: file=<txt|md file>

→ 202 {
    jobId: "<uuid>",          // poll with GET /jobs/:jobId
    documentId: "<uuid>",
    bullmqJobId: "<string>",
    pollUrl: "/jobs/<uuid>"
  }

Errors:
  400  Missing file / empty file / unsupported MIME type (only txt + md accepted)
  401  ADMIN_TOKEN set but Authorization header missing or wrong
  500  DB or queue failure
```

```
POST /ingest/manual
  Authorization: Bearer <token>   (required when ADMIN_TOKEN set)
  Content-Type: application/json
  Body: { title, company, date, rawText, severity?, tags? }

→ 201  full Incident object (synchronous — no job tracking)

Errors:
  400  Missing required fields
  401  Auth failure
```

```
POST /ingest/:documentId
  Enqueue a parse job for a previously uploaded document.

→ 202 { jobId: "<uuid>", documentId: "<uuid>" }

Errors:
  404  Document not found
```

### Job Status

```
GET /jobs/:jobId
  Rate-limited: max 60 req / 60s per IP.

→ 200 {
    id: "<uuid>",
    status: "waiting" | "active" | "completed" | "failed",
    progress: 0–100,
    result: { incidentId: "<uuid>" } | null,
    error: "<string>" | null,
    documentId: "<uuid>",
    parseStatus: "pending" | "processing" | "done" | "failed"
  }

Errors:
  400  Malformed job ID (not a UUID)
  404  Job not found
  429  Rate limit exceeded
```

### Incidents

```
GET /incidents
→ 200  Incident[]   (most recent first)

GET /incidents/:id
→ 200  Incident + sections[]

Errors:
  404  Incident not found
```

### Documents

```
GET /documents
→ 200  Document[]
```

### Sources

```
GET /sources
→ 200  Source[]

POST /sources
  Authorization: Bearer <token>   (required when ADMIN_TOKEN set)
  Body: { name, url, type?, crawlPolicy? }

→ 201  Source object

Errors:
  400  Missing name or url
  401  Auth failure
  409  URL already registered
```

---

## Sprint 2 — Retrieval (Search & Similarity)

### Search
```
GET /search?q=<text>&limit=<n>
  Hybrid FTS + vector similarity search across incident titles and section text.

→ 200 {
    "results": [
      {
        "incident": { "id": "<uuid>", "title": "<string>", "severity": "<string>", "date": "<iso8601>" },
        "score": 0.89,
        "evidence": [
          { "id": "<uuid>", "type": "rootcause", "text": "<matched snippet>" }
        ]
      }
    ]
  }

Errors:
  400  Missing or malformed query
```

### Similar Incidents
```
GET /incidents/:id/similar
  Returns top-N similar incidents by embedding cosine distance on `summary_embedding`.

→ 200 {
    "similar": [
      {
        "incident": { "id": "<uuid>", "title": "<string>", "severity": "<string>", "date": "<iso8601>" },
        "score": 0.95,
        "reason": "<string, e.g., 'Matches strongly on root cause similarity'>"
      }
    ]
  }

Errors:
  404  Incident not found
```

---

## Sprint 3 — Knowledge Graph

Graph extraction runs after incident section parsing and embedding indexing in both supported ingest paths:

- `POST /ingest/manual` parses submitted `rawText`, stores sections, indexes embeddings, then calls graph extraction before returning the incident.
- `POST /ingest/upload` enqueues worker parsing; the worker stores the incident and sections, indexes embeddings, then calls graph extraction before marking the job complete.

Shipped node types are `service`, `symptom`, `root_cause`, and `fix`. Shipped relationship types are `AFFECTS`, `HAS_SYMPTOM`, `CAUSED_BY`, and `RESOLVED_BY`. Every graph edge includes `evidence_section_id`; clients use that section ID with `GET /incidents/:id` to build anchors shaped as `#section-{section.type}-{section.id}`.

### Graph Patterns
```
GET /graph/patterns?service=...&symptom=...&page=1
  Returns recurring graph clusters (patterns) across incidents.
  Filters are substring matches over service and symptom node names.

→ 200 {
    "patterns": [
      {
        "incidentCount": 4,
        "nodes": [
          { "id": "<uuid>", "name": "api-gateway", "type": "service" },
          { "id": "<uuid>", "name": "502 bad gateway", "type": "symptom" }
        ]
      }
    ],
    "page": 1,
    "hasMore": false
  }

Errors:
  400  Empty or malformed filter parameters
```

### Graph Neighbors
```
GET /graph/neighbors?node_id=...&depth=1
  Returns adjacent nodes and connecting edges for visualization (e.g. react-force-graph-2d).
  Max allowed depth is `2` (hard-capped). Default depth is `1`.

→ 200 {
    "nodes": [
      { "id": "<uuid>", "name": "db-primary", "type": "service" },
      { "id": "<uuid>", "name": "high cpu", "type": "symptom" }
    ],
    "edges": [
      {
        "id": "<uuid>",
        "from": "<uuid>",
        "to": "<uuid>",
        "type": "HAS_SYMPTOM",
        "evidence_section_id": "<uuid>" // Mandatory for deep links
      }
    ]
  }

Errors:
  400  Missing/malformed node_id, depth < 1, or depth > 2
  404  Node not found
```

---

## Sprint 4 - Evaluation, Q&A, Auth, and Audit (Frozen)

Sprint 4 keeps the evidence-first product rule: generated answers and quality claims must be backed by returned incident sections, or the API must refuse. Graph edges may help discover relevant evidence sections, but graph nodes/edges are not standalone answer text.

### Auth, Rate-Limit, and Error Contract

Bearer tokens use `Authorization: Bearer <token>`.

| Route group | Auth | Rate limit |
|-------------|------|------------|
| `GET /health` | Public | No app-level limit; infrastructure health checks allowed. |
| `GET /incidents`, `GET /incidents/:id`, `GET /search`, `GET /graph/*` | Public for MVP demo unless `READ_TOKEN_REQUIRED=true` | 60 req/min/IP. Graph depth remains capped at 2. |
| `GET /jobs/:jobId` | Public only for unguessable UUID job IDs; token optional in production | 60 req/60s/IP. |
| `POST /ingest/*`, `POST /sources` | `ADMIN_TOKEN` required when set; required in production | 10 req/min/token or IP. Upload size/type limits still apply. |
| Scraping/fetch enqueue routes | Admin-triggered only | 1 req/sec/domain and 30 enqueue req/hour/admin token. |
| `POST /eval/queries`, `POST /eval/run` | `ADMIN_TOKEN` required | 5 query mutations/min/token; 3 eval runs/hour/token. |
| `GET /eval/latest` | Public in local/demo; token-gated in production if reports expose internal config | 30 req/min/IP. |
| `POST /qa` | `QA_TOKEN` or `ADMIN_TOKEN` required in production; unauthenticated local dev allowed only when neither token env var is configured | 10 req/min/token or IP, burst 5, max question length 1000 chars. |

Standard errors:

```
401 { "error": "Unauthorized" }
403 { "error": "Forbidden" }
429 { "error": "Rate limit exceeded", "retryAfterSeconds": 30 }
500 { "error": "Internal server error" }
```

Errors must not include stack traces, raw prompts, provider payloads, bearer tokens, or API keys.

### Evaluation Query Upsert

```
POST /eval/queries
  Authorization: Bearer <ADMIN_TOKEN>
  Content-Type: application/json
  Body: {
    "querySetVersion": "sprint4-seed-v1",
    "replace": false,
    "queries": [
      {
        "id": "payment-api-rootcause",
        "question": "What caused the payment-api outage?",
        "expectedIncidentIds": ["<uuid>"],
        "expectedSectionIds": ["<uuid>"],
        "expectedGraphNodeIds": ["<uuid>"],
        "queryType": "search" | "graph" | "qa" | "mixed",
        "critical": true,
        "tags": ["rootcause", "demo"],
        "metadata": {}
      }
    ]
  }

-> 200 {
    "querySetVersion": "sprint4-seed-v1",
    "imported": 1,
    "updated": 0,
    "skipped": 0,
    "queries": [
      {
        "id": "payment-api-rootcause",
        "question": "What caused the payment-api outage?",
        "queryType": "search",
        "critical": true,
        "tags": ["rootcause", "demo"]
      }
    ]
  }

Errors:
  400  Empty query list, invalid query type, missing question, malformed IDs
  401  Admin auth failure
  429  Eval query mutation limit exceeded
```

`id` is stable across seed imports so historical reports remain comparable. `replace=true` means the named `querySetVersion` is replaced by the provided list; `replace=false` means upsert by `id`.

### Evaluation Run

```
POST /eval/run
  Authorization: Bearer <ADMIN_TOKEN>
  Content-Type: application/json
  Body: {
    "querySetVersion": "sprint4-seed-v1",
    "mode": "fixture" | "live",
    "queryIds": ["payment-api-rootcause"],
    "includeGraph": true,
    "includeQa": false,
    "baselineRunId": "<uuid|null>",
    "thresholds": {
      "criticalRecallAt5": 1.0,
      "maxRecallAt5Drop": 0.05,
      "maxMrrDrop": 0.05,
      "requireEvidenceEdgeCoverage": 1.0,
      "requireQaCitationPrecision": 1.0,
      "requireRefusalAccuracy": 1.0
    }
  }

-> 201 {
    "runId": "<uuid>",
    "status": "passed" | "failed" | "error",
    "mode": "fixture",
    "querySetVersion": "sprint4-seed-v1",
    "startedAt": "<iso8601>",
    "finishedAt": "<iso8601>",
    "gitSha": "<sha|null>",
    "artifactPath": "artifacts/eval/<runId>/eval_report.json",
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
    "thresholds": {},
    "failures": []
  }

Errors:
  400  Unknown querySetVersion, no runnable queries, invalid threshold config
  401  Admin auth failure
  429  Eval run limit exceeded
  500  Eval runner error; response remains sanitized
```

`POST /eval/run` is synchronous for Sprint 4's small seeded dataset. It writes one immutable report artifact, writes an `eval_runs` row, updates the latest report by completion time, and writes an audit log. CI should prefer `mode: "fixture"`; release smoke may use `mode: "live"` when provider credentials are configured.

### Latest Evaluation Report

```
GET /eval/latest

-> 200 {
    "runId": "<uuid>",
    "status": "passed" | "failed" | "error",
    "mode": "fixture" | "live",
    "querySetVersion": "sprint4-seed-v1",
    "createdAt": "<iso8601>",
    "finishedAt": "<iso8601>",
    "gitSha": "<sha|null>",
    "retrievalConfig": {
      "searchLimit": 10,
      "evidenceSectionLimit": 8,
      "embeddingModel": "text-embedding-3-small"
    },
    "graphConfig": {
      "enabled": true,
      "maxDepth": 1
    },
    "promptVersion": "qa-v1",
    "models": [
      { "provider": "openai", "model": "<model>", "version": "<version|null>" }
    ],
    "metrics": {},
    "thresholds": {},
    "failures": [],
    "artifactPath": "artifacts/eval/<runId>/eval_report.json"
  }

Errors:
  401  Auth failure when production config gates eval reports
  404  No eval run has completed
  429  Latest-report rate limit exceeded
```

### Citations-First Q&A

```
POST /qa
  Authorization: Bearer <QA_TOKEN|ADMIN_TOKEN>   (required in production)
  Content-Type: application/json
  Body: {
    "question": "What fixed the payment-api outage?",
    "filters": {
      "company": "Acme",
      "tags": ["payments"],
      "incidentIds": ["<uuid>"]
    },
    "options": {
      "maxEvidenceSections": 8,
      "includeGraphContext": true,
      "mode": "answer" | "eval"
    }
  }

-> 200 {
    "status": "answered",
    "answer": "The payment-api incident was mitigated by rolling back the bad deploy and draining failing workers. [C1]",
    "citations": [
      {
        "label": "C1",
        "incidentId": "<uuid>",
        "sectionId": "<uuid>",
        "sectionType": "fix",
        "title": "Payment API elevated errors",
        "company": "Acme",
        "date": "<iso8601|null>",
        "excerpt": "Engineers rolled back the deployment and drained failing workers...",
        "anchor": "#section-fix-<uuid>",
        "retrievalScore": 0.91
      }
    ],
    "evidenceCount": 3,
    "promptVersion": "qa-v1",
    "model": {
      "provider": "openai",
      "name": "<model>",
      "version": "<version|null>"
    },
    "auditId": "<uuid>"
  }
```

Citation rules:
- `citations[]` must contain only sections retrieved before generation.
- `anchor` must use the existing incident-section fragment: `#section-{sectionType}-{sectionId}`.
- `excerpt` is capped at 320 chars and must come from the cited section text.
- Default evidence budget is the top 8 deduped sections. `maxEvidenceSections` may be lowered by callers and may not exceed 12.
- Every factual answer sentence must include at least one citation label such as `[C1]`.
- Prompt output must include `promptVersion`, model metadata, and an `auditId`.

Refusal response:

```
-> 200 {
    "status": "refused",
    "answer": null,
    "citations": [],
    "refusal": {
      "reasonCode": "insufficient_evidence" | "unsupported_scope" | "unsafe_prompt" | "citation_validation_failed",
      "message": "I do not have enough cited incident evidence to answer that."
    },
    "evidenceCount": 0,
    "promptVersion": "qa-v1",
    "model": {
      "provider": "openai",
      "name": "<model>",
      "version": "<version|null>"
    },
    "auditId": "<uuid>"
  }
```

Refusal behavior:
- No retrieved section, weakly related retrieval, out-of-corpus questions, broad questions needing unavailable incidents, and prompt-injection attempts must return `status: "refused"`.
- Production refusals omit retrieved context by default. `options.mode: "eval"` may include non-sensitive insufficiency counters in `debug` for evaluation only.
- If post-validation finds an uncited factual claim or a citation outside the retrieved evidence packet, return `reasonCode: "citation_validation_failed"` rather than a partial answer.

Errors:
  400  Missing/empty question, question longer than 1000 chars, invalid filters/options
  401  Q&A auth failure when token env vars are configured
  429  Q&A rate limit exceeded
