/**
 * @pkg/nlp — TurboQuant-style compressed vector retrieval (EXPERIMENTAL)
 *
 * A practical MVP of rotation + scalar quantization for low-memory approximate
 * nearest-neighbor scoring, inspired by TurboQuant / RaBitQ-family methods:
 *
 *   1. Rotate the vector with a randomized orthonormal transform so coordinate
 *      magnitudes spread evenly (rotation = "hadamard" → randomized Hadamard
 *      transform; "random" → seeded sign-flip + permutation).
 *   2. Scalar-quantize each rotated coordinate to TURBOQUANT_BITS bits
 *      (uniform symmetric grid, asymmetric scoring: the query stays
 *      full-precision, only stored vectors are compressed).
 *   3. Optionally store one residual sign bit per dimension plus the mean
 *      absolute residual ("QJL-inspired" first-order correction):
 *        residual ≈ meanAbs · sign(residual)  ⇒  dot(q, residual) ≈ meanAbs · Σ qᵢ·signᵢ
 *
 * What this is NOT: a production-grade TurboQuant implementation. There is no
 * claim of the paper's optimality bounds. Promotion criteria and the math
 * behind each step live in docs/TURBOQUANT_RAG_PLAN.md. pgvector remains the
 * stable baseline; this backend exists to be benchmarked against it.
 *
 * Memory: 4-bit codes = 8× smaller than float32 (16× vs float64 JSON),
 * + dims/8 bytes when residual sign bits are enabled.
 *
 * Pure math, zero dependencies, fully deterministic given a seed.
 */

// ─── Seeded PRNG ───────────────────────────────────────────────────────────────

/** mulberry32 — small, fast, deterministic PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// ─── Rotations (orthonormal, seeded) ───────────────────────────────────────────

const signCache = new Map();
const permCache = new Map();

function getSignFlips(dims, seed) {
  const key = `${dims}:${seed}`;
  let signs = signCache.get(key);
  if (!signs) {
    const rand = mulberry32(seed);
    signs = new Float64Array(dims);
    for (let i = 0; i < dims; i += 1) signs[i] = rand() < 0.5 ? -1 : 1;
    signCache.set(key, signs);
  }
  return signs;
}

function getPermutation(dims, seed) {
  const key = `${dims}:${seed}`;
  let perm = permCache.get(key);
  if (!perm) {
    const rand = mulberry32(seed ^ 0x9e3779b9);
    perm = new Uint32Array(dims);
    for (let i = 0; i < dims; i += 1) perm[i] = i;
    for (let i = dims - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = perm[i];
      perm[i] = perm[j];
      perm[j] = tmp;
    }
    permCache.set(key, perm);
  }
  return perm;
}

/** In-place fast Walsh–Hadamard transform, normalized so the transform is orthonormal. */
function fwht(vector) {
  const n = vector.length;
  for (let len = 1; len < n; len *= 2) {
    for (let i = 0; i < n; i += len * 2) {
      for (let j = i; j < i + len; j += 1) {
        const a = vector[j];
        const b = vector[j + len];
        vector[j] = a + b;
        vector[j + len] = a - b;
      }
    }
  }
  const scale = 1 / Math.sqrt(n);
  for (let i = 0; i < n; i += 1) vector[i] *= scale;
  return vector;
}

/**
 * Rotate a vector with the configured seeded orthonormal transform.
 * Pads to the next power of two (orthonormal transforms preserve norms,
 * and zero-padding preserves dot products).
 *
 * @param {number[] | Float64Array} vector
 * @param {{ rotation?: "hadamard" | "random", seed?: number }} [opts]
 * @returns {Float64Array} rotated vector (length = next power of two ≥ input)
 */
export function rotateVector(vector, opts = {}) {
  const rotation = opts.rotation ?? "hadamard";
  const seed = opts.seed ?? 1337;
  const padded = nextPowerOfTwo(vector.length);

  const out = new Float64Array(padded);
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i];

  const signs = getSignFlips(padded, seed);
  for (let i = 0; i < padded; i += 1) out[i] *= signs[i];

  if (rotation === "hadamard") {
    fwht(out);
    return out;
  }

  // "random": seeded permutation after sign flips (cheaper, no FWHT pass).
  const perm = getPermutation(padded, seed);
  const permuted = new Float64Array(padded);
  for (let i = 0; i < padded; i += 1) permuted[i] = out[perm[i]];
  return permuted;
}

// ─── Code packing ──────────────────────────────────────────────────────────────

function packCodes(codes, bits) {
  if (bits === 8) return Uint8Array.from(codes);
  if (bits === 4) {
    const packed = new Uint8Array(Math.ceil(codes.length / 2));
    for (let i = 0; i < codes.length; i += 1) {
      const byte = i >> 1;
      if (i % 2 === 0) packed[byte] = codes[i] & 0x0f;
      else packed[byte] |= (codes[i] & 0x0f) << 4;
    }
    return packed;
  }
  if (bits === 2) {
    const packed = new Uint8Array(Math.ceil(codes.length / 4));
    for (let i = 0; i < codes.length; i += 1) {
      packed[i >> 2] |= (codes[i] & 0x03) << ((i % 4) * 2);
    }
    return packed;
  }
  throw new Error(`TURBOQUANT_BITS must be 2, 4, or 8 (got ${bits})`);
}

export function unpackCodes(packed, dims, bits) {
  const codes = new Uint8Array(dims);
  if (bits === 8) {
    codes.set(packed.subarray(0, dims));
    return codes;
  }
  if (bits === 4) {
    for (let i = 0; i < dims; i += 1) {
      const byte = packed[i >> 1];
      codes[i] = i % 2 === 0 ? byte & 0x0f : (byte >> 4) & 0x0f;
    }
    return codes;
  }
  if (bits === 2) {
    for (let i = 0; i < dims; i += 1) {
      codes[i] = (packed[i >> 2] >> ((i % 4) * 2)) & 0x03;
    }
    return codes;
  }
  throw new Error(`TURBOQUANT_BITS must be 2, 4, or 8 (got ${bits})`);
}

function packSignBits(values) {
  const packed = new Uint8Array(Math.ceil(values.length / 8));
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] >= 0) packed[i >> 3] |= 1 << (i % 8);
  }
  return packed;
}

// ─── Quantization ──────────────────────────────────────────────────────────────

/**
 * Compress one embedding into a TurboQuant code.
 *
 * @param {number[]} vector   raw (storage-padded) embedding
 * @param {{ bits?: number, rotation?: string, seed?: number, residualQjl?: boolean, dims?: number }} [opts]
 *   `dims` — native dimensionality to compress (trailing storage padding is dropped).
 * @returns {{
 *   codes: Uint8Array, residual: Uint8Array | null,
 *   meta: { bits, rotation, seed, dims, paddedDims, scale, offset, qnorm, resScale }
 * } | null}
 */
export function quantizeVector(vector, opts = {}) {
  if (!Array.isArray(vector) || vector.length === 0) return null;
  const bits = opts.bits ?? 4;
  const rotation = opts.rotation ?? "hadamard";
  const seed = opts.seed ?? 1337;
  const residualQjl = opts.residualQjl ?? true;
  const dims = Math.min(opts.dims ?? vector.length, vector.length);

  const rotated = rotateVector(vector.slice(0, dims), { rotation, seed });
  const paddedDims = rotated.length;

  let maxAbs = 0;
  for (let i = 0; i < paddedDims; i += 1) {
    const abs = Math.abs(rotated[i]);
    if (abs > maxAbs) maxAbs = abs;
  }
  if (maxAbs === 0) return null;

  const levels = (1 << bits) - 1;
  const scale = (2 * maxAbs) / levels;
  const offset = -maxAbs;

  const codes = new Uint8Array(paddedDims);
  const residuals = new Float64Array(paddedDims);
  let qnormSq = 0;
  let resAbsSum = 0;

  for (let i = 0; i < paddedDims; i += 1) {
    const code = Math.max(0, Math.min(levels, Math.round((rotated[i] - offset) / scale)));
    codes[i] = code;
    const reconstructed = code * scale + offset;
    qnormSq += reconstructed * reconstructed;
    residuals[i] = rotated[i] - reconstructed;
    resAbsSum += Math.abs(residuals[i]);
  }

  return {
    codes: packCodes(codes, bits),
    residual: residualQjl ? packSignBits(residuals) : null,
    meta: {
      bits,
      rotation,
      seed,
      dims,
      paddedDims,
      scale,
      offset,
      qnorm: Math.sqrt(qnormSq),
      resScale: resAbsSum / paddedDims,
    },
  };
}

/**
 * Prepare a query for asymmetric scoring against codes produced with the same
 * rotation settings. The query stays full-precision.
 *
 * @param {number[]} vector
 * @param {{ rotation?: string, seed?: number, dims?: number }} [opts]
 * @returns {{ rotated: Float64Array, norm: number } | null}
 */
export function prepareQuery(vector, opts = {}) {
  if (!Array.isArray(vector) || vector.length === 0) return null;
  const dims = Math.min(opts.dims ?? vector.length, vector.length);
  const rotated = rotateVector(vector.slice(0, dims), {
    rotation: opts.rotation ?? "hadamard",
    seed: opts.seed ?? 1337,
  });
  let normSq = 0;
  for (let i = 0; i < rotated.length; i += 1) normSq += rotated[i] * rotated[i];
  const norm = Math.sqrt(normSq);
  if (norm === 0) return null;
  return { rotated, norm };
}

/**
 * Approximate cosine similarity between a prepared query and one stored code.
 *
 * @param {{ rotated: Float64Array, norm: number }} query   from prepareQuery()
 * @param {{ codes: Uint8Array, residual: Uint8Array | null, meta: object }} stored
 * @returns {number} approximate cosine in [-1, 1]
 */
export function approxCosine(query, stored) {
  const { bits, paddedDims, scale, offset, qnorm, resScale } = stored.meta;
  if (query.rotated.length !== paddedDims) return 0;

  const codes = unpackCodes(stored.codes, paddedDims, bits);
  let dot = 0;
  for (let i = 0; i < paddedDims; i += 1) {
    dot += query.rotated[i] * (codes[i] * scale + offset);
  }

  // QJL-inspired first-order residual correction:
  // residual ≈ resScale · sign(residual)  ⇒  dot(q, residual) ≈ resScale · Σ qᵢ·signᵢ
  if (stored.residual && resScale > 0) {
    let signDot = 0;
    for (let i = 0; i < paddedDims; i += 1) {
      const sign = (stored.residual[i >> 3] >> (i % 8)) & 1 ? 1 : -1;
      signDot += query.rotated[i] * sign;
    }
    dot += resScale * signDot;
  }

  const denominator = query.norm * (qnorm || 1);
  if (denominator === 0) return 0;
  return Math.max(-1, Math.min(1, dot / denominator));
}

/**
 * Brute-force scan a list of stored codes for the top-K approximate matches.
 *
 * @param {{ rotated: Float64Array, norm: number }} query
 * @param {Array<{ id: string, codes: Uint8Array, residual: Uint8Array | null, meta: object }>} entries
 * @param {number} [topK=50]
 * @returns {Array<{ id: string, score: number }>} sorted descending by score
 */
export function scanCodes(query, entries, topK = 50) {
  const scored = [];
  for (const entry of entries) {
    scored.push({ id: entry.id, score: approxCosine(query, entry) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ─── (De)serialization for DB storage ─────────────────────────────────────────

/**
 * Serialize a quantized entry for storage (codes/residual as Buffers + JSON meta).
 * @param {{ codes: Uint8Array, residual: Uint8Array | null, meta: object }} quantized
 */
export function serializeQuantized(quantized) {
  return {
    codes: Buffer.from(quantized.codes),
    residual: quantized.residual ? Buffer.from(quantized.residual) : null,
    meta: quantized.meta,
  };
}

/**
 * Deserialize a stored row back into a scorable entry.
 * @param {{ codes: Buffer | Uint8Array, residual: Buffer | Uint8Array | null, meta: object }} row
 */
export function deserializeQuantized(row) {
  return {
    codes: row.codes instanceof Uint8Array ? row.codes : new Uint8Array(row.codes),
    residual: row.residual
      ? row.residual instanceof Uint8Array
        ? row.residual
        : new Uint8Array(row.residual)
      : null,
    meta: row.meta,
  };
}

/** Bytes used by one compressed entry (codes + residual sign bits). */
export function compressedSizeBytes(quantized) {
  return quantized.codes.byteLength + (quantized.residual?.byteLength ?? 0);
}
