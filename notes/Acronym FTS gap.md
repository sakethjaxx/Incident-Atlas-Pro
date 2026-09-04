---
aliases: [Acronym FTS gap, Short token retrieval, FTS AND problem]
tags: [project/incident-atlas-pro, retrieval, bug]
---

# Acronym FTS gap

An open retrieval weakness ([[Pitch caveats and gaps]] #5). Questions built around short tokens / acronyms — "s3", "k8s", "OOM", "SSL", "CDN" — can wrongly **refuse**.

## Root cause
[[Hybrid retrieval]]'s keyword candidate uses Postgres `plainto_tsquery('english', q)`, which **ANDs every content lexeme**. A question like *"What caused the Amazon S3 outage?"* becomes `amazon & s3 & outag` — a chunk must contain **all three**. A chunk that says *"S3 became unavailable"* (no "amazon", no "outage") never matches. If vectors are also weak (hash [[embeddings]] on a 2-token query), retrieval returns nothing → the [[Sufficiency gate]] refuses.

## Current workaround
Name the company in the question, or pass an `incidentIds` filter. (Documented; used in the [[Eval harness]] for the AWS S3 2017 case.)

## Candidate fix (not yet applied — needs DB to verify)
OR-join the query terms instead of AND: build a `to_tsquery` of sanitized tokens joined by `|`, rank by `ts_rank`, and gate by score. Improves multi-term recall broadly. **Deliberately not blind-patched** — a wrong retrieval change hurts a pitch more than a documented gap, and it can't be verified without `pnpm db:up`.

```bash
# to verify a fix:
pnpm db:up
node scripts/eval-real.mjs --fresh   # watch AWS S3 / acronym queries stop refusing
```

Lives in `packages/db/src/retrieval.js` → `chunkKeywordCandidates()`.
