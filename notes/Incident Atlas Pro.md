---
aliases: [Incident Atlas Pro, IAP, incident-ingest]
tags: [project/incident-atlas-pro, moc, rag]
created: 2026-07-09
updated: 2026-07-10
status: pre-pitch
---

# Incident Atlas Pro

> [!abstract] One line
> A **self-hosted, 100% open-source [[RAG]] system** over engineering **postmortems** — ingest incident write-ups, then ask questions and get **citation-first** answers (every sentence cited, or the system refuses).

This is a **Map of Content** — the vault hub. Every `[[link]]` opens a real note.

---

## Start here
- [[Architecture]] — monorepo, apps/packages, request surface
- [[Data model]] — Prisma schema: incidents → sections → chunks → graph
- [[Hybrid retrieval]] — how a question finds evidence
- [[Citations-first QA]] — how evidence becomes a cited answer (or a refusal)
- [[Open-source RAG stack]] — the no-paid-API model contract
- [[Knowledge Graph]] — entity graph + viz
- [[Eval harness]] — how quality is measured
- [[Confidence scoring]] — the per-answer trust signal
- [[Pitch caveats and gaps]] — the honest weakness list ⭐

---

## The one-diagram version
```
Postmortem → parse into typed sections → chunk → [[embeddings|embed]]
   → [[pgvector]] store
   → ask a question
   → [[Hybrid retrieval]]: filters → FTS ∥ vector → [[RRF fusion]] → [[reranker]] → top 5–8 chunks
   → [[Sufficiency gate]] → not enough? → [[Refusal gating|refuse]]
   → answer: [[Extractive QA]] (default) or [[Ollama]]+[[Qwen3]] (optional)
   → every sentence carries a [Cn] citation, re-validated
   → answer + citations + [[Confidence scoring|confidence]] + audit log
```

## Why it's different
1. **[[Citations-first QA|Trust]]** — cited or refused, by construction. 100% refusal accuracy.
2. **[[Open-source RAG stack|Privacy]]** — no third-party LLM; data never leaves the box.
Target customer: tech companies **100–2000 employees** who can't ship incident history to a third party.

---

## Key files
| Area | File |
|---|---|
| Provider config | `packages/nlp/src/providers.js` |
| Embedding + tokenizer | `packages/nlp/src/index.js` |
| Hybrid retrieval | `packages/db/src/retrieval.js` |
| QA orchestration | `apps/api/src/lib/qa.js` |
| LLM generation | `apps/api/src/lib/qaGenerate.js` |
| Graph extraction | `packages/nlp/src/graphExtract.js` |
| Eval runner | `scripts/eval-real.mjs` |
| Web QA page | `apps/web/src/routes/Qa.tsx` |

---

## Session log — 2026-07-09/10 (pitch-readiness)
Fixed:
- 🟢 [[Confidence scoring]] recalibration + High/Med/Low tier (killed the "<55% on correct answers" bug). Test: `apps/api/src/tests/confidence.test.js`.
- 🟢 [[Eval harness]] honesty stamp — runs now record which [[Open-source RAG stack|stack]] produced the numbers.
- 🐛 Found orphaned unit tests (`src/__tests__/` isn't globbed by the `test` script) — moved the new one into `src/tests/`.

Deliberately not fixed (need infra, won't blind-patch): [[Acronym FTS gap]] (needs Postgres to verify), real-stack eval numbers (need [[Ollama]] up). Full analysis: [[Pitch caveats and gaps]].

---

## Glossary (stubs — Obsidian fills the graph)
[[RAG]] · [[embeddings]] · [[pgvector]] · [[RRF fusion]] · [[reranker]] · [[Sufficiency gate]] · [[Refusal gating]] · [[Extractive QA]] · [[Ollama]] · [[Qwen3]] · [[TurboQuant]] · [[Similar incidents]]

## Open actions
- [ ] Run [[Eval harness]] on bge + [[Qwen3]]; commit the labeled numbers.
- [ ] Decide/verify the [[Acronym FTS gap]] fix (OR-join tsquery).
- [ ] Move the other orphaned unit tests into `src/tests/`.
- [ ] Draft the honest roadmap slide (corpus / multi-tenancy / scale).
- [ ] Decide demo path: [[Extractive QA]] (safe) vs [[Ollama]] (better, unbenchmarked).
