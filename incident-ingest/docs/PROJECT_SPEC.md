# Incident Atlas Pro — Project Spec (v0.2)

**Date:** 2026-03-07  
**Goal:** Build a deployable 8-week MVP for **Incident Atlas Pro** — an incident-intelligence system with **Incident Knowledge Graph (IKG)** + **Hybrid Retrieval (keyword + vector + reranking)** using **open-source/public incident data**.

## What it solves
During outages, engineers waste time searching scattered knowledge (postmortems, status pages, runbooks, GitHub incident reports). Incident Atlas Pro builds a searchable incident memory that can quickly answer:
- Have we seen this pattern?
- What typically caused it?
- What mitigations worked?

## MVP pillars
1. **Ingestion + normalization** (crawl/scrape or upload; extract fields; store raw + structured)
2. **Incident sectioning** (impact / timeline / root cause / mitigation)
3. **Hybrid search** (FTS + vector over summaries/sections + filters)
4. **Similarity + reasons** ("similar incidents" with explanation)
5. **Knowledge graph explorer** (causes ↔ symptoms ↔ services; top recurring patterns)
6. **Evidence-first Q&A (optional generation)** with citations + refusal when evidence insufficient
7. **Postmortem outline generator** (template/questions; no invented facts)

## Agentic execution note (no Perplexity credits)
This project uses a 7-role agentic workflow. If Perplexity API is unavailable, the **Research / Source-of-truth** role runs on **Gemini + web browsing + official docs** and must still produce links and a decision memo.

## Non-goals (MVP scope control)
- No enterprise connectors requiring paid keys
- No fully automated “perfect” scraping; best-effort extraction + fallback manual upload
- No heavy custom model training; use off-the-shelf embeddings / rerankers
- Generation is optional; retrieval and evidence UX are primary

## Definition of Done (MVP)
- Upload/crawl ≥ 30–50 incident docs into DB
- Search returns relevant incidents with evidence sections and filters
- Similar incidents panel shows “reasons”
- Graph explorer displays top patterns and neighbor browsing with evidence pointers
- Eval harness runs in CI and tracks MRR/Recall@K over a seed query set
- (Optional) Q&A returns citations or refuses if unsupported
- Deployable demo with 5-min script
