# Step-by-Step Execution Plan (Entire Project)

**Updated:** 2026-03-07

## 0) One-time setup (Day 0)
1. Create repo skeleton: `apps/web`, `apps/api`, `apps/worker`, `packages/nlp`, `packages/eval`, `infra`, `docs`, `antigravity`
2. Copy docs from this pack into your repo `docs/`
3. Copy `antigravity/agents.yaml` and `antigravity/TASK_BOARD.json` into your repo `antigravity/`
4. Bring up Postgres + Redis (docker compose)
5. Confirm quality gate:
   - migrations apply from scratch
   - API boots
   - at least one integration test runs

## 1) How agent work runs (every day)
1. Orchestrator picks next ticket (TODO)
2. Assigned agent produces artifact (diff/notes/commands)
3. QA Reviewer tries to break it; files fix tickets if needed
4. Builder fixes; Reviewer re-checks
5. Integrator merges + updates runbook/demo if needed

## 2) Sprint 1 (Weeks 1–2): Foundations
Deliver:
- schema + migrations
- upload ingestion + job status
- parse/extract/section minimal pipeline
- incident detail UI
Tests:
- migration smoke test
- ingestion integration test

## 3) Sprint 2 (Weeks 3–4): Search + Similarity
Deliver:
- embeddings + vector store
- keyword search + filters
- hybrid search + similar incidents + reasons
Tests:
- retrieval regression (Recall@10, MRR) on seed queries

## 4) Sprint 3 (Weeks 5–6): Knowledge Graph v1
Deliver:
- entity extraction + nodes/edges with evidence pointers
- graph endpoints + graph explorer UI
Tests:
- edges must point to valid evidence sections

## 5) Sprint 4 (Weeks 7–8): Quality + Deploy
Deliver:
- eval in CI with gating
- citations-first Q&A + refusal behavior (optional)
- rate limits, retries, caching
- deploy + 5-min demo script
