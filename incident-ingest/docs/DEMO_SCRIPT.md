# Incident Atlas Pro - Demo Script (Sprint 4)

> **Sprint scope:** Ingestion, retrieval, graph extraction, evals, citations-first Q&A, and auth limits.

---

## Pre-Demo Checklist

```bash
docker compose up -d --wait
pnpm run api:migrate
pnpm --filter @app/api dev
pnpm --filter @app/worker dev
pnpm --filter @app/web dev
```

Local URLs:

- API: `http://localhost:3001`
- Web: `http://localhost:5173`

Before the live walkthrough, run the release smoke once:

```bash
bash scripts/smoke-test.sh
```

The smoke creates the deterministic `payment-api` incident and verifies the `/qa` endpoint returns a response or safe refusal.

---

## The Demo (10 minutes)

### 1. Ingest an incident (1.5 min)

**Action:** Navigate to the **Upload** page and upload a text file.

**Narrative:** Raw incident notes become typed sections first. The backend performs embedding indexing and graph extraction automatically.

---

### 2. Citations-first Q&A (3 min)

**Action:** Open `http://localhost:5173/qa` and ask "What caused the checkout outage?"

**Narrative:** Q&A is grounded purely in our incidents. We retrieve the exact sections, pass them to the LLM, and require extractive citations. The UI clearly highlights citations linking back to the source sections.

**Action:** Ask an out-of-scope question like "Who is the CEO?"

**Watch:** The API refuses to answer, protecting against hallucination and prompt-injection by falling back safely.

---

### 3. Evaluation & Quality (2 min)

**Action:** Navigate to `http://localhost:5173/eval`

**Narrative:** We don't guess if the LLM works. Our evaluation harness automatically runs tests against a JSON seed dataset of deterministic incident queries, calculating Recall@K, MRR, and Citation Precision before any release.

---

### 4. Graph & Retrieval (2.5 min)

**Action:** Show `/search` and `/graph` to highlight the base structures enabling the Q&A.

**Narrative:** The knowledge graph and hybrid search are the foundation providing the evidence sections that make our Q&A trustworthy.

---

## Close with the release proof (1 min)

**Action:** Show the final line from `bash scripts/smoke-test.sh`.

**Narrative:** The full Sprint 4 release smoke verifies the complete path: ingest, extraction, graph, eval, and citations-first Q&A.

---

## Next Steps
Sprint 5 will focus on expanding data sources and production scaling!
