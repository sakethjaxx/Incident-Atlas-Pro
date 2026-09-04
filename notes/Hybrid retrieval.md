---
aliases: [Hybrid retrieval, Retrieval pipeline, RAG Pipeline, Chunk retrieval]
tags: [project/incident-atlas-pro, retrieval, rag]
---

# Hybrid retrieval

The "R" in [[RAG]]. Turns a question into the top 5–8 evidence [[Data model|chunks]] that [[Citations-first QA]] answers from. Code: `packages/db/src/retrieval.js` → `retrieveChunkEvidence()`.

## Why hybrid?
Keyword search (FTS) nails exact terms but misses paraphrase. Vector search catches meaning but drifts on rare tokens. Run **both**, then merge — you get recall from vectors and precision from keywords.

## The pipeline
```
question
 → metadata filters (company / severity / tag / date / incidentIds)  ← cheap, first
 → run candidate backends in parallel:
      • keyword   : Postgres FTS (ts_rank_cd over chunk text)
      • vector    : [[pgvector]] cosine (RETRIEVAL_BACKEND=pgvector|hybrid)
      • turboquant: [[TurboQuant]] compressed scan (experimental, off by default)
 → [[RRF fusion]] merges the ranked lists (rank-based, no score normalization)
 → intent boost: chunks whose section type matches the question intent ×1.2
 → [[reranker]] re-scores the top ~40 (RERANKER_PROVIDER=none|local|bge)
 → keep top N (5–8) with exact section citation anchors
```

## Key design points
- **Filters before scoring** — chunks carry denormalized company/severity/tags so scoping is a WHERE clause, not a post-filter.
- **Similarity floor** (`VECTOR_MATCH_THRESHOLD = 0.25`) — ANN always returns *nearest* neighbors even for off-topic queries; the floor stops junk from sneaking past the [[Sufficiency gate]].
- **Intent detection** — `detectSectionIntent()` maps "how was it fixed?" → `fix` section, and boosts those chunks before rerank.
- **Graceful fallback** — if the chunk index is empty/missing, retrieval returns `null` and QA falls back to a **legacy section-level** search. Old deployments keep working.
- **Traces** — in eval mode each candidate carries per-backend ranks/scores for debugging.

## Known weakness
Short tokens / acronyms ("s3", "k8s", "OOM") can fail: `plainto_tsquery` **ANDs every query term**, so a chunk must contain all of them. See [[Acronym FTS gap]] and [[Pitch caveats and gaps]].

Building blocks: [[RRF fusion]] · [[reranker]] · [[embeddings]] · [[pgvector]] · [[TurboQuant]]
