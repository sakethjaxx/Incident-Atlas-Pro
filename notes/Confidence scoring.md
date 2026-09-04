---
aliases: [Confidence scoring, Confidence, Confidence badge, Confidence tier]
tags: [project/incident-atlas-pro, qa]
---

# Confidence scoring

The per-answer trust signal shown in the [[Citations-first QA|Ask]] UI. Code: `calculateConfidence()` + `confidenceTier()` in `apps/api/src/lib/qa.js`; badge in `apps/web/src/routes/Qa.tsx`.

## The bug (fixed 2026-07-09)
Old formula: `topScore / (topScore + 1) + evidenceBoost`.
`topScore/(topScore+1)` maps `[0,1] → [0, 0.5]` — a **squash**. So even a perfect top score (1.0) maxed at ~0.5, and every real answer read **<55% confidence**. A "Low confidence" badge on *correct* answers actively undercut the product's whole trust pitch. See [[Pitch caveats and gaps]] #4.

## The fix
```js
confidence = min(0.98, topScore * 0.8 + corroborationBoost + 0.05)
// topScore already lives in [0,1] (cosine / rerank / keyword floor) — use it directly.
// corroborationBoost: +0.07 per extra chunk above the strong-evidence floor, capped +0.20.
```
Then a **tier** replaces the false-precision percentage in the UI:
```js
confidenceTier: >=0.70 → "high"  |  >=0.45 → "medium"  |  else "low"
```
A three-way High / Medium / Low badge is honest about a heuristic; a precise "62%" implies calibration the retrieval score doesn't have.

## Behavior now
- Strong + corroborated evidence → **High** (≥0.7).
- Single weak hit → **Low** (<0.45), and the UI shows a "verify against sources" banner.
- Refusals → confidence 0, tier `low`.

## Verification
`apps/api/src/tests/confidence.test.js` — 7 offline unit tests (no-squash, monotonic in top score, corroboration reward, 0.98 ceiling, tier bands). Run: `pnpm --filter @app/api exec vitest run src/tests/confidence.test.js`.

> [!note] Still a heuristic
> This is a retrieval-derived confidence, not a calibrated probability. The tier is deliberately coarse so it can't over-claim. Real calibration would need labeled correctness data.
