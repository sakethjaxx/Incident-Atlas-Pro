---
aliases: [Open-source RAG stack, Providers, Model config, Provider contract]
tags: [project/incident-atlas-pro, rag, config]
---

# Open-source RAG stack

The hard constraint that shapes the whole project: **no Anthropic, no OpenAI, no paid APIs — anywhere in runtime or docs.** Everything self-hosted. Code: `packages/nlp/src/providers.js` → `getRagConfig(env)`.

**Why:** the product sells to companies that won't ship incident data to a third party. Also: free, low-compute, offline tests.

## Every model access goes through `getRagConfig()` (pure function of env)

| Concern | Env var | Options | Default |
|---|---|---|---|
| [[embeddings]] | `EMBEDDING_PROVIDER` | `local` / `bge` / `ollama` | `local` |
| " model | `EMBEDDING_MODEL` | e.g. `BAAI/bge-small-en-v1.5`, `bge-m3` | bge-small |
| QA generation | `QA_PROVIDER` | `local` / `ollama` | `local` |
| Graph extract | `GRAPH_EXTRACTOR` | `rules` / `ollama` | `rules` |
| [[reranker]] | `RERANKER_PROVIDER` | `none` / `local` / `bge` | `none` |
| Retrieval backend | `RETRIEVAL_BACKEND` | `pgvector` / `turboquant` / `hybrid` | `pgvector` |
| LLM server | `OLLAMA_URL` | — | `localhost:11434` |

## The provider ladder (local → real)
- **`local`** — deterministic **hash [[embeddings]]** + [[Extractive QA]] + **rule** [[Knowledge Graph\|graph]]. Zero deps, offline, test-safe. **This is the default the committed metrics run on** — which is why they under-represent real quality (see [[Pitch caveats and gaps]]).
- **`bge`** — real embeddings via `@huggingface/transformers` (ONNX, in-process, lazy-loaded) + `bge-reranker-base`.
- **`ollama`** — [[Qwen3]]-4B for QA + graph, or `bge-m3` embeddings, served by [[Ollama]].

## Rules of the stack
- Model-backed providers are **lazy** — nothing imported/contacted until used.
- Normal tests **never** hit the network — `local`/`rules` defaults keep them offline.
- Fixed `vector(1536)` storage; smaller model vectors L2-normalized + zero-padded → cosine unchanged. After switching model: `pnpm reindex:chunks`.
- [[TurboQuant]] is **experimental** — never the default; promotion criteria in `docs/TURBOQUANT_RAG_PLAN.md`.

Connects: [[Hybrid retrieval]] · [[Citations-first QA]] · [[Eval harness]]
