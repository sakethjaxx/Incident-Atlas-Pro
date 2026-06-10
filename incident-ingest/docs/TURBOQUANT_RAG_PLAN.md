# TurboQuant RAG Plan (EXPERIMENTAL)

Status: **implemented as an experimental, benchmarkable retrieval backend.**
pgvector remains the stable production baseline. TurboQuant is **not** the
default and must not be promoted until the criteria at the bottom pass on a
realistic corpus.

## What it is

A practical MVP of rotation + scalar quantization for low-memory approximate
vector retrieval, inspired by the TurboQuant / RaBitQ family of methods.
Implementation: `packages/nlp/src/turboquant.js` (pure math, seeded,
deterministic, zero deps). Honest scope note: this is *TurboQuant-style*
compression, not a verified implementation of the paper — none of the paper's
optimality bounds are claimed.

### Math, step by step

1. **Rotation.** Each stored embedding `x` (native dims, padded to the next
   power of two) is transformed with a seeded orthonormal rotation `R`:
   - `TURBOQUANT_ROTATION=hadamard` → randomized Hadamard transform
     (`H · D`, where `D` is a seeded ±1 diagonal): spreads coordinate energy
     evenly so a uniform scalar grid wastes fewer bits on outliers.
   - `TURBOQUANT_ROTATION=random` → seeded sign-flips + permutation (cheaper,
     weaker mixing).
   Rotations are orthonormal: norms and inner products are preserved exactly,
   so `cos(q, x) = cos(Rq, Rx)`.

2. **Scalar quantization.** Each rotated coordinate is snapped to a uniform
   symmetric grid with `TURBOQUANT_BITS` bits (2/4/8; default 4):
   `code_i = round((x_i − offset) / scale)` with `offset = −max|x|`,
   `scale = 2·max|x| / (2^bits − 1)`. Codes are bit-packed (4-bit → 2/byte).
   Scoring is **asymmetric**: the query stays full-precision and is only
   rotated; the stored side is dequantized on the fly. This keeps query-side
   error at zero, the standard trick for scalar-quantized ANN.

3. **QJL-inspired residual correction** (`TURBOQUANT_RESIDUAL_QJL=true`).
   One sign bit per dimension of the residual `r = Rx − x̂`, plus the scalar
   `resScale = mean|r_i|`, are stored. At query time:
   `dot(q, r) ≈ resScale · Σ_i q_i · sign(r_i)` — a first-order correction in
   the spirit of Quantized Johnson–Lindenstrauss sketches. Costs dims/8 bytes.

4. **Verification.** The approximate scan returns top-K candidates; when full
   pgvector vectors are available, candidates are re-scored with exact cosine
   before fusion (`turboquant-verified` in benchmarks). This is the
   recommended mode — compression then only affects *candidate generation*,
   not final ordering.

### Memory budget (per vector, 384-d native → 512 padded)

| Representation | Bytes |
|---|---|
| float32 (native 384) | 1,536 |
| 4-bit codes | 256 |
| + residual sign bits | 64 |
| + per-vector meta (scale/offset/qnorm/resScale) | ~48 |
| **Total compressed** | **~368 (≈ 4.6× smaller)** |

At 8 bits the factor is ~2.6×; at 2 bits ~8× (with worse recall).

## Configuration

```bash
RETRIEVAL_BACKEND=pgvector|turboquant|hybrid   # default pgvector
TURBOQUANT_ENABLED=true|false                  # write codes at index time
TURBOQUANT_BITS=4                              # 2 | 4 | 8
TURBOQUANT_ROTATION=hadamard                   # hadamard | random
TURBOQUANT_RESIDUAL_QJL=true
TURBOQUANT_SEED=1337                           # must stay fixed per index
```

- Codes are stored per chunk in `chunks.tq_codes` / `tq_residual` / `tq_meta`.
- `TURBOQUANT_ENABLED=true` makes ingest/reindex write codes; the
  `RETRIEVAL_BACKEND` switch controls whether they are *used* at query time.
- Changing bits/rotation/seed requires `pnpm reindex:chunks` — rows quantized
  with different settings are skipped at query time (detected via `tq_meta`).
- `hybrid` fuses the pgvector list and the TurboQuant list with RRF — useful
  for side-by-side evaluation in production traffic without switching over.

## Current MVP limits

- The compressed scan is a **brute-force in-process scan** (load codes for the
  filtered candidate set, score in JS). Fine for ≤ ~100k chunks; there is no
  IVF/HNSW structure over the codes yet.
- Codes are loaded from Postgres per query (no warm in-memory cache yet).
  Latency numbers therefore understate what a cached implementation would do.
- The residual correction is a first-order heuristic, not the full QJL
  estimator with variance guarantees.
- Recall numbers below come from the small deterministic fixture set; they are
  sanity proof, **not** production evidence.

## Benchmark results (fixture set, local deterministic embeddings, 4-bit)

From `pnpm bench` (38 chunks, 14 answerable queries — see `artifacts/bench/`):

| Backend | recall@5 | recall@10 | MRR | nDCG@10 |
|---|---|---|---|---|
| vector-exact (pgvector-equivalent) | 0.964 | 1.000 | 1.000 | 0.986 |
| turboquant-raw | 0.964 | 1.000 | 1.000 | 0.987 |
| turboquant-verified | 0.964 | 1.000 | 1.000 | 0.987 |

recall@5 delta vs exact: **0.000**; memory reduction: **4.6×**.

## Promotion criteria (to become a default production path)

All of the following on a corpus of ≥ 10k real incident chunks:

1. recall@10 delta vs pgvector exact ≥ −0.02 (verified mode).
2. End-to-end search latency p95 ≤ pgvector HNSW p95 (with code cache).
3. Memory reduction ≥ 4× measured on the real index.
4. No citation-precision regression in `--mode live` benchmarks.
5. Re-index + seed-rotation procedure documented and exercised once.

Until then: keep `RETRIEVAL_BACKEND=pgvector` in production.
