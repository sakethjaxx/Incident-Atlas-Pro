# Incident Atlas Pro — Demo Script (Sprint 2 Retrieval)

> **Sprint scope:** Ingestion pipeline, keyword/vector search, similar incidents, and UI integration.  
> Knowledge graph is a Sprint 3 feature.

---

## Pre-Demo Checklist

```bash
docker compose up -d --wait          # db, redis, worker all healthy
pnpm run api:migrate                  # schema applied from scratch
pnpm --filter @app/api dev           # API on :3001
pnpm --filter @app/web dev           # Web UI on :3000
```

Seed file ready: `test-incident.txt` — a short Markdown postmortem with Impact / Root Cause / Mitigation headings.

---

## The Demo (7 minutes)

### 1. Ingest a raw incident document (2 min)

**Action:** Open `http://localhost:3000` → navigate to the **Ingest** page → drag-and-drop `test-incident.txt`.

**Narrative:**  
> "During any live incident or postmortem, engineers are drowning in raw text—Slack threads, status pages, Markdown docs. Incident Atlas Pro accepts whatever format you have and automatically structures it."

**Watch:** The upload button shows progress; the response panel displays a `jobId` and `documentId`.

---

### 2. Show job pipeline & embedding generation (1.5 min)

**Action:** The UI polls `/jobs/<jobId>`. Watch the status badge transition:  
`queued` → `processing` → **`completed`**

**Narrative:**  
> "In the background, our BullMQ worker extracts text, slices it into typed sections, and seamlessly generates vector embeddings via pgvector. The worker has a heartbeat healthcheck so it self-heals if it ever goes zombie."

---

### 3. Search and Evidence Retrieval (2 min)

**Action:** Navigate to the **Search** page. Type a query like "database pool" and execute.

**Narrative:**  
> "Now let's see Sprint 2's hybrid search in action. We query both exact keywords and semantic meaning. The results show not just the incident, but highlighted evidence snippets pointing directly to the sections that matched."

**Watch:** Search results render with score badges and evidence snippets below the incident title.

---

### 4. Similar Incidents & Deep Dive (1.5 min)

**Action:** Click on an incident to view its detail page. Scroll down to the **Similar Incidents** panel.

**Narrative:**  
> "When diagnosing an ongoing outage, you want to know if it's happened before. Incident Atlas automatically calculates vector similarity to past incidents and provides human-readable 'reasons' for why they match."

**Watch:** Similar incident cards load with scores and reasons.

---

## Sprint 2 Done. What's Next?

| Sprint | Upcoming Feature |
|---|---|
| 3 | Entity extraction, graph APIs, and graph explorer UI |
| 4 | Evaluation harness, citations-first Q&A, auth |
