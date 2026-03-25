# Requirements (MVP)

## Functional requirements
### Ingestion + normalization
- Crawl/scrape or upload raw docs (HTML/PDF/Markdown)
- Extract and store: title, date, duration, impact, timeline, root cause, mitigations
- Store **raw document** + **extracted text** + **structured metadata**
- Async job pipeline (queue worker) with retries/backoff and per-step status

### Incident sections
- Split incidents into typed sections:
  - impact
  - timeline
  - root cause
  - fix/mitigation
- Persist sections separately for retrieval + UI highlighting

### Hybrid search
- Full-text search + vector search over incident summaries and sections
- Filters: date / company / category / tags
- Return ranked incidents + matching sections + scores

### Similarity + reasons
- Endpoint + UI panel for “similar incidents”
- Provide “reasons” such as:
  - matched symptoms
  - same trigger
  - similar fix

### Knowledge graph explorer
- Nodes: Service, Symptom, Trigger, RootCause, Fix, Runbook
- Edges: AFFECTS, HAS_SYMPTOM, TRIGGERED_BY, CAUSED_BY, RESOLVED_BY
- Graph browsing and top recurring pattern queries
- Every edge stores an evidence pointer to a section

### Evidence-backed Q&A (optional)
- Retrieval-first: answer from returned evidence only
- Must cite exact incident excerpts / section references
- Must refuse when evidence is insufficient

### Postmortem outline generator
- Given a new incident description, produce a postmortem outline + questions
- Must not invent incident facts; uses templates and prompts only

## Non-functional requirements
- Evidence-first UX: citations or refusal (no unsupported claims)
- Repeatability: evaluation harness with regression in CI
- Robust ingestion: store raw + best-effort extraction + manual correction path
- Security (MVP):
  - basic auth for admin ingestion endpoints
  - rate limits on scraping and Q&A
  - audit logs for prompt/versioned outputs

## Quality gates
- Every PR includes tests for new logic
- Backend boots locally; DB connectivity verified
- Migrations apply cleanly from scratch
- CI runs unit + integration tests + eval regression
