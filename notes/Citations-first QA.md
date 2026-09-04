---
aliases: [Citations-first QA, QA, Question answering, Ask]
tags: [project/incident-atlas-pro, qa, rag]
---

# Citations-first QA

The product's core promise: **every answer sentence is cited, or the system refuses.** No unsourced claims by construction. Code: `apps/api/src/lib/qa.js` → `answerQuestion()`, endpoint `POST /qa`.

## Flow (guards run in order, cheapest first)
```
1. scope check      → public-web scope not configured → refuse
2. unsafe prompt    → jailbreak / "ignore instructions" / "no citations" → refuse
3. out-of-scope     → code-gen / weather / CEO bio / stock price → refuse
4. [[Hybrid retrieval]]  → top evidence chunks
5. unsafe evidence  → retrieved text contains injection → refuse
6. [[Sufficiency gate]]  → enough strong, on-intent evidence? → else refuse
7. generate answer  → [[Extractive QA]] (default) or [[Ollama]] LLM
8. validate citations → every sentence has a valid [Cn] label → else refuse
9. return answer + citations + [[Confidence scoring]] + audit
```

## The two answer paths
- **[[Extractive QA]]** *(default, `QA_PROVIDER=local`)* — deterministic: quote the sentences from cited sections that overlap the question. Offline, safe, test-stable. **Literal** — misses facts it doesn't quote (see key-fact 31% in [[Pitch caveats and gaps]]).
- **[[Ollama]] + [[Qwen3]]** *(`QA_PROVIDER=ollama`)* — a local LLM writes 1–4 sentences, each forced to carry a `[Cn]` label. Output is **re-validated**: any uncited/hallucinated-label sentence → fall back to extractive → then refusal. Better answers, but not the default and not in CI.

## Why refusal is a feature
`assessSufficiency()` refuses when: no evidence, only weak evidence, evidence is graph-context only, or the question's required section type is missing. Comparison questions ("X vs Y") need ≥2 incidents. **Refusal accuracy was 100%** on the eval set — that's the trust story.

## Citation integrity
`validateAnswerCitations()` enforces: every sentence has a `[Cn]`; every used label maps to real provided evidence; citations point to sections that were actually retrieved. Guards against a generated answer inventing sources.

Related: [[Sufficiency gate]] · [[Refusal gating]] · [[Confidence scoring]] · [[Extractive QA]] · [[Knowledge Graph]] (graph context can *enrich* but never *justify* an answer alone)
