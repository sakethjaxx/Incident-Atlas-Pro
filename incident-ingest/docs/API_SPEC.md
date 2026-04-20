# API Spec

> **Last updated:** 2026-04-20  
> **Sprint 1 status:** ✅ All endpoints shipped and verified.

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

## Sprint 2 Preview (not yet implemented)

```
GET /search?q=<text>&limit=<n>
  Hybrid FTS + vector similarity search across incident titles and section text.

GET /incidents/:id/similar
  Returns top-N similar incidents by embedding cosine distance.
```

---

## Sprint 3 — Knowledge Graph (planned)

```
GET /graph/patterns?service=...&symptom=...
GET /graph/neighbors?node_id=...&depth=1
```

---

## Sprint 4 — Evaluation & Q&A (planned)

```
POST /eval/queries
POST /eval/run
GET  /eval/latest
POST /qa   (citations-first; refuse if unsupported)
```
