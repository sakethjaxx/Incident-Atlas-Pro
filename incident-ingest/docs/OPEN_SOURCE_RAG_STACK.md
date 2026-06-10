# Open-Source RAG Stack

Incident Atlas Pro runs a fully open-source, low-compute RAG pipeline.
**No Anthropic. No OpenAI. No paid model APIs.** Every model-backed step has a
deterministic local fallback, so the system (and its test suite) works offline.

## Stack matrix

| Stage | Default (offline) | Recommended open model | Served by |
|---|---|---|---|
| Embeddings | `local` deterministic hash (1536-d) | `BAAI/bge-small-en-v1.5` (384-d) | in-process ONNX (`@huggingface/transformers`) |
| Embeddings (stronger) | — | `BAAI/bge-m3` (1024-d, multilingual) | Ollama (`/api/embed`) |
| Reranker | `none` / `local` token-overlap | `BAAI/bge-reranker-base` | TEI-compatible HTTP endpoint (`/rerank`) |
| Q&A generation | `local` extractive + citations | `Qwen3-4B-Instruct` (`qwen3:4b`) | Ollama (`/api/generate`) |
| Graph extraction | `rules` (deterministic regex) | `qwen3:4b` strict-JSON mode | Ollama |
| Vector store (baseline) | PostgreSQL + pgvector (HNSW, IVFFlat fallback) | — | docker `pgvector/pgvector:pg16` |
| Vector store (experimental) | TurboQuant-style compressed codes | — | in-process scan (see [TURBOQUANT_RAG_PLAN.md](TURBOQUANT_RAG_PLAN.md)) |

## Configuration (env)

```bash
# Embeddings
EMBEDDING_PROVIDER=local|bge|ollama
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5      # or bge-m3 with ollama
EMBEDDING_DIMENSIONS=384                     # native model dims (1024 for bge-m3)

# Q&A generation
QA_PROVIDER=local|ollama
QA_MODEL=qwen3:4b

# Graph extraction
GRAPH_EXTRACTOR=rules|ollama
GRAPH_MODEL=qwen3:4b

# Reranking
RERANKER_PROVIDER=none|local|bge
RERANKER_MODEL=BAAI/bge-reranker-base
RERANKER_URL=http://localhost:8080           # TEI endpoint, only for bge

# Ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_TIMEOUT_MS=60000

# Retrieval backend
RETRIEVAL_BACKEND=pgvector|turboquant|hybrid
TURBOQUANT_ENABLED=true|false
```

All knobs are read by `getRagConfig()` in `packages/nlp/src/providers.js` —
the single source of truth for provider resolution.

## Storage contract: fixed `vector(1536)` columns

The pgvector columns are `vector(1536)`. Model-native embeddings smaller than
1536 dims (bge-small = 384, bge-m3 = 1024) are **L2-normalized then zero-padded**
to 1536. Zero-padding changes neither dot products nor norms, so cosine
distance in pgvector is mathematically identical to cosine on the native
vector. This avoids a destructive column migration when switching models.

**Rule:** never mix embeddings from different providers/models in one index.
After changing `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`, rebuild the chunk index:

```bash
pnpm reindex:chunks            # = node apps/worker/src/reindex.js --chunks-only
```

Chunk rows record `embedding_provider`, `embedding_model`, `embedding_dim` so a
mixed index is detectable.

## Retrieval pipeline (Sprint 5)

```
question
  → metadata filters (company / severity / tag / incidentIds)
  → Postgres full-text search over chunks   (top 50)
  → vector backend over chunks              (top 50)
      pgvector  : HNSW cosine (stable baseline)
      turboquant: compressed approximate scan + full-vector verification (EXPERIMENTAL)
      hybrid    : both lists
  → Reciprocal Rank Fusion (k = 60)
  → rerank top 40 (RERANKER_PROVIDER)
  → top 5–8 evidence chunks with exact section citation anchors
```

Chunks are built per section: one `section` chunk always, plus `paragraph`
chunks (~700 chars, 80-char overlap) for long sections. Every chunk carries
`incident_id` + `section_id`, so citations always point at an exact section.

Debug traces (backend, keyword/vector/fused/rerank scores) are returned by
`POST /qa` with `options.mode="eval"` and by `GET /search?debug=1`.

## Setting up the model-backed providers

### Ollama (generation, bge-m3 embeddings)

```bash
# install: https://ollama.com/download
ollama pull qwen3:4b      # QA + graph extraction (~2.6 GB)
ollama pull bge-m3        # optional stronger embeddings (~1.2 GB)
```

Then set `QA_PROVIDER=ollama`, `GRAPH_EXTRACTOR=ollama`, and optionally
`EMBEDDING_PROVIDER=ollama EMBEDDING_MODEL=bge-m3 EMBEDDING_DIMENSIONS=1024`.

### bge-small in-process (no extra server)

```bash
pnpm add @huggingface/transformers --filter @pkg/nlp
```

Set `EMBEDDING_PROVIDER=bge`. The ONNX model (~35 MB quantized) downloads on
first use and is cached locally. This dependency is intentionally **optional** —
it is not in the lockfile and is never needed for tests.

### bge-reranker via TEI

```bash
docker run -p 8080:80 ghcr.io/huggingface/text-embeddings-inference:cpu-latest \
  --model-id BAAI/bge-reranker-base
```

Set `RERANKER_PROVIDER=bge RERANKER_URL=http://localhost:8080`. On any endpoint
failure the reranker degrades to the deterministic `local` token-overlap scorer.

## Guarantees

- **Tests never hit the network.** Defaults are `local` / `rules` / `none`.
- **Every Q&A answer sentence carries a `[Cn]` citation** that is validated
  after generation against the retrieved evidence; otherwise the system
  degrades to the extractive answerer, then refuses.
- **Refusals** fire for insufficient evidence, unsafe prompts, and
  citation-validation failures; all are audit-logged.
- **Graph edges always carry `evidence_section_id`** — LLM-extracted edges are
  validated against the real section-id set and dropped otherwise.

## Benchmarks

```bash
pnpm bench                      # fixture mode: offline, no DB
node scripts/benchmark.mjs --mode live   # end-to-end against a running API
```

See `fixtures/bench/` for the deterministic dataset and
[TURBOQUANT_RAG_PLAN.md](TURBOQUANT_RAG_PLAN.md) for the TurboQuant promotion
criteria. Reports land in `artifacts/bench/` (gitignored).
