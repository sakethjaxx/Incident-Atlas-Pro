# Incident Atlas Pro — Demo Script (Week 1 / Sprint 1 Foundation)

> **Sprint scope:** Ingestion pipeline only (upload → queue → parse → structured incident).  
> Search, similarity, and knowledge graph are Sprint 2–3 features.

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

## The Demo (5 minutes)

### 1. Ingest a raw incident document (2 min)

**Action:** Open `http://localhost:3000` → navigate to the **Ingest** page → drag-and-drop `test-incident.txt`.

**Narrative:**  
> "During any live incident or postmortem, engineers are drowning in raw text—Slack threads, status pages, Markdown docs. Incident Atlas Pro accepts whatever format you have and automatically structures it."

**Watch:** The upload button shows progress; the response panel displays a `jobId` and `documentId`.

---

### 2. Show job pipeline (1.5 min)

**Action:** The UI polls `/jobs/<jobId>`. Watch the status badge transition:  
`queued` → `processing` → **`completed`**

**Narrative:**  
> "In the background, our BullMQ worker picks up the job from Redis, extracts text, and slices it into typed sections—Impact, Timeline, Root Cause, Mitigation—then persists everything to Postgres. The worker has a heartbeat healthcheck so it self-heals if it ever goes zombie."

**Callout:** Point to the terminal with `pnpm --filter @app/worker dev` showing live log lines:  
```
[worker] → Processing job <uuid> | documentId=<uuid>
[worker:health] Heartbeat writing to /tmp/worker-heartbeat.json every 10s
[worker] ✓ Job <uuid> done | incidentId=<uuid>
```

---

### 3. View the structured incident (1.5 min)

**Action:** Click through to the **Incident Detail** view for the newly created incident.

**Narrative:**  
> "The raw blob is now a structured record. You can see the extracted sections highlighted independently. This is the data foundation that Sprint 2's hybrid search and Sprint 3's knowledge graph will build on."

**Callout:** Show the `sections` array in the API response:  
```bash
curl http://localhost:3001/incidents/<incidentId> | jq '.sections[].type'
# → "impact" "rootcause" "fix"
```

---

## Sprint 1 Done. What's Next?

| Sprint | Upcoming Feature |
|---|---|
| 2 | Embeddings + vector store + hybrid search (FTS + pgvector) |
| 3 | Similar incidents panel with reasons |
| 4 | Knowledge graph explorer + eval harness |
