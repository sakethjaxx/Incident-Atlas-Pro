---
aliases: [Eval harness, Evaluation, Eval, Metrics]
tags: [project/incident-atlas-pro, eval, quality]
---

# Eval harness

How the project proves quality instead of claiming it — a scripted query set with expected answers, scored and (in CI) gated. Code: `scripts/eval-real.mjs` (+ `apps/api/src/lib/eval.js`, `GET /eval/latest`, `EvalRun` in [[Data model]]).

## What it measures
Ingests the real-postmortem corpus, then runs QA + search queries and scores:

| Metric | Meaning | Last known |
|---|---|---|
| QA answered rate | % questions answered (vs refused) | 90% (18/20) |
| Key-fact hit rate | expected facts present in the answer | **31%** ⚠ |
| Citation precision | right incident cited | 85% |
| Search recall (avg) | expected incident in results | 88% |
| Refusal accuracy | correct refuse-vs-answer decision | 100% (4/4) |
| QA p50 latency | — | ~76ms |

> [!warning] Read the numbers with the stack in mind
> These ran on the **`local` default** (hash [[embeddings]] + [[Extractive QA]]) — near keyword quality. **Key-fact 31%** is the extractive limit, not a retrieval bug: it quotes sentences but misses the specific number/code. The [[Ollama]]/[[Qwen3]] path should lift it but isn't benchmarked. See [[Pitch caveats and gaps]].

## Honesty stamp (added 2026-07-09)
`eval-real.mjs` now prints `Stack: embedding=… qa=…` and writes it into the scores JSON, so a committed metric always says which [[Open-source RAG stack|provider stack]] produced it. No more ambiguous numbers.

## CI gating (plan)
Track metrics per PR; fail the build if recall drops past a threshold or a `critical` query regresses. Store config + model versions + `eval_report.json` per run (`EvalRun`).

## To get real-stack numbers
```bash
pnpm db:up                       # Postgres
# start Ollama with qwen3:4b
EMBEDDING_PROVIDER=bge QA_PROVIDER=ollama node scripts/eval-real.mjs --fresh
```

Corpus: 16 real postmortems (AWS S3, Slack, Monzo Redis, Notion K8s, PagerDuty SSL, Stripe, GitHub failover, …) in `fixtures/eval/`.
