/**
 * @pkg/nlp — open-source model provider abstraction
 *
 * All model access in Incident Atlas Pro flows through this module.
 * The stack is 100% open source / self-hosted:
 *
 *   Embeddings : EMBEDDING_PROVIDER = local | bge | ollama
 *                  local  → deterministic hash embedding (zero deps, offline, test-safe)
 *                  bge    → BAAI/bge-small-en-v1.5 via @huggingface/transformers (ONNX, in-process)
 *                  ollama → any embedding model served by Ollama (e.g. bge-m3)
 *   Generation : QA_PROVIDER / GRAPH_EXTRACTOR = local|rules or ollama (Qwen3-4B-Instruct)
 *   Reranking  : RERANKER_PROVIDER = none | local | bge   (see rerank.js)
 *
 * Design rules:
 *   • No Anthropic. No OpenAI. No paid APIs.
 *   • Normal tests never make network calls — `local`/`rules` are the defaults.
 *   • Model-backed providers are lazy: nothing is imported or contacted until used.
 *   • The DB storage contract is a fixed vector(1536) column. Smaller model
 *     embeddings (bge-small = 384-d, bge-m3 = 1024-d) are zero-padded to 1536.
 *     Zero-padding preserves dot products and norms, so cosine distance in
 *     pgvector is identical to cosine on the native vector.
 */

// Note: only function imports from index.js here (safe in the module cycle
// index.js → graphExtract.js → providers.js → index.js). Do NOT import consts.
import { createEmbedding } from "./index.js";

/** Fixed dimensionality of the pgvector columns (DB contract: vector(1536)). */
export const STORAGE_DIMENSIONS = 1536;

const DEFAULTS = {
  EMBEDDING_PROVIDER: "local",
  EMBEDDING_MODEL: "BAAI/bge-small-en-v1.5",
  EMBEDDING_DIMENSIONS: 384,
  QA_PROVIDER: "local",
  QA_MODEL: "qwen3:4b",
  GRAPH_EXTRACTOR: "rules",
  GRAPH_MODEL: "qwen3:4b",
  RERANKER_PROVIDER: "none",
  RERANKER_MODEL: "BAAI/bge-reranker-base",
  RETRIEVAL_BACKEND: "pgvector",
  OLLAMA_URL: "http://localhost:11434",
  OLLAMA_TIMEOUT_MS: 60_000,
  TURBOQUANT_ENABLED: false,
  TURBOQUANT_BITS: 4,
  TURBOQUANT_ROTATION: "hadamard",
  TURBOQUANT_RESIDUAL_QJL: true,
  TURBOQUANT_SEED: 1337,
};

function envInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function envEnum(value, allowed, fallback) {
  const v = String(value ?? "").trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

/**
 * Resolve the full RAG provider configuration from environment variables.
 * Pure function of `env` — pass a custom object in tests.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function getRagConfig(env = process.env) {
  return {
    embedding: {
      provider: envEnum(env.EMBEDDING_PROVIDER, ["local", "bge", "ollama"], DEFAULTS.EMBEDDING_PROVIDER),
      model: env.EMBEDDING_MODEL?.trim() || DEFAULTS.EMBEDDING_MODEL,
      dimensions: envInt(env.EMBEDDING_DIMENSIONS, DEFAULTS.EMBEDDING_DIMENSIONS),
    },
    qa: {
      provider: envEnum(env.QA_PROVIDER, ["local", "ollama"], DEFAULTS.QA_PROVIDER),
      model: env.QA_MODEL?.trim() || DEFAULTS.QA_MODEL,
    },
    graph: {
      extractor: envEnum(env.GRAPH_EXTRACTOR, ["rules", "ollama"], DEFAULTS.GRAPH_EXTRACTOR),
      model: env.GRAPH_MODEL?.trim() || DEFAULTS.GRAPH_MODEL,
    },
    reranker: {
      provider: envEnum(env.RERANKER_PROVIDER, ["none", "local", "bge"], DEFAULTS.RERANKER_PROVIDER),
      model: env.RERANKER_MODEL?.trim() || DEFAULTS.RERANKER_MODEL,
      /** Optional HTTP endpoint serving BAAI/bge-reranker-base (TEI `/rerank` contract). */
      url: env.RERANKER_URL?.trim() || null,
    },
    retrieval: {
      backend: envEnum(env.RETRIEVAL_BACKEND, ["pgvector", "turboquant", "hybrid"], DEFAULTS.RETRIEVAL_BACKEND),
    },
    turboquant: {
      enabled: envBool(env.TURBOQUANT_ENABLED, DEFAULTS.TURBOQUANT_ENABLED),
      bits: envInt(env.TURBOQUANT_BITS, DEFAULTS.TURBOQUANT_BITS),
      rotation: envEnum(env.TURBOQUANT_ROTATION, ["hadamard", "random"], DEFAULTS.TURBOQUANT_ROTATION),
      residualQjl: envBool(env.TURBOQUANT_RESIDUAL_QJL, DEFAULTS.TURBOQUANT_RESIDUAL_QJL),
      seed: envInt(env.TURBOQUANT_SEED, DEFAULTS.TURBOQUANT_SEED),
    },
    ollama: {
      url: (env.OLLAMA_URL?.trim() || DEFAULTS.OLLAMA_URL).replace(/\/+$/, ""),
      timeoutMs: envInt(env.OLLAMA_TIMEOUT_MS, DEFAULTS.OLLAMA_TIMEOUT_MS),
    },
  };
}

// ─── Ollama HTTP client (zero-dep, global fetch) ──────────────────────────────

async function ollamaFetch(config, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ollama.timeoutMs);
  try {
    const res = await fetch(`${config.ollama.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Ollama ${path} ${res.status}: ${detail.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate text with an Ollama-served model (e.g. qwen3:4b).
 * Throws on any failure — callers decide the fallback.
 *
 * @param {{ model: string, prompt: string, system?: string, json?: boolean, temperature?: number }} opts
 * @param {ReturnType<typeof getRagConfig>} [config]
 * @returns {Promise<string>}
 */
export async function ollamaGenerate(opts, config = getRagConfig()) {
  const payload = {
    model: opts.model,
    prompt: opts.prompt,
    stream: false,
    options: { temperature: opts.temperature ?? 0 },
  };
  if (opts.system) payload.system = opts.system;
  if (opts.json) payload.format = "json";

  const data = await ollamaFetch(config, "/api/generate", payload);
  const text = typeof data?.response === "string" ? data.response : "";
  if (!text.trim()) throw new Error("Ollama returned an empty response");
  return text;
}

/**
 * Embed a batch of texts with an Ollama-served embedding model (e.g. bge-m3).
 * Uses the modern `/api/embed` endpoint.
 *
 * @param {string[]} texts
 * @param {ReturnType<typeof getRagConfig>} [config]
 * @returns {Promise<number[][]>}
 */
export async function ollamaEmbed(texts, config = getRagConfig()) {
  const data = await ollamaFetch(config, "/api/embed", {
    model: config.embedding.model,
    input: texts,
  });
  const embeddings = data?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error("Ollama /api/embed returned an unexpected shape");
  }
  return embeddings;
}

// ─── bge via @huggingface/transformers (optional, lazy) ───────────────────────

let _bgePipelinePromise = null;

async function getBgePipeline(model) {
  if (!_bgePipelinePromise) {
    _bgePipelinePromise = (async () => {
      let transformers;
      try {
        transformers = await import("@huggingface/transformers");
      } catch {
        try {
          transformers = await import("@xenova/transformers");
        } catch {
          throw new Error(
            "EMBEDDING_PROVIDER=bge requires an optional dependency. " +
              "Run: pnpm add @huggingface/transformers --filter @pkg/nlp " +
              "(or set EMBEDDING_PROVIDER=local|ollama)"
          );
        }
      }
      return transformers.pipeline("feature-extraction", model, { dtype: "q8" });
    })();
  }
  return _bgePipelinePromise;
}

/** Test hook — reset the cached bge pipeline. */
export function resetBgePipelineForTest() {
  _bgePipelinePromise = null;
}

// ─── Embedding dispatch ────────────────────────────────────────────────────────

/**
 * BGE v1.5 models retrieve better when queries carry this instruction prefix.
 * Passages/documents are embedded without a prefix.
 */
const BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

function l2Normalize(vector) {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return null;
  return vector.map((value) => value / norm);
}

/**
 * Zero-pad a native-dimension embedding up to the vector(1536) storage contract.
 * Throws if the native vector is larger than storage — that requires a schema
 * migration, not silent truncation.
 *
 * @param {number[]} vector
 * @returns {number[]}
 */
export function padToStorageDimensions(vector) {
  if (vector.length > STORAGE_DIMENSIONS) {
    throw new Error(
      `Embedding has ${vector.length} dims but storage is vector(${STORAGE_DIMENSIONS}). ` +
        "Choose a smaller model or migrate the column."
    );
  }
  if (vector.length === STORAGE_DIMENSIONS) return vector;
  return [...vector, ...new Array(STORAGE_DIMENSIONS - vector.length).fill(0)];
}

/**
 * Embed a batch of texts with the configured provider.
 * Returns storage-ready vectors: L2-normalized, zero-padded to 1536 dims.
 * Entries that cannot be embedded (empty text) come back as null.
 *
 * @param {string[]} texts
 * @param {{ isQuery?: boolean, config?: ReturnType<typeof getRagConfig> }} [opts]
 * @returns {Promise<Array<number[] | null>>}
 */
export async function embedTexts(texts, opts = {}) {
  const config = opts.config ?? getRagConfig();
  const provider = config.embedding.provider;

  if (provider === "local") {
    return texts.map((text) => createEmbedding(text, STORAGE_DIMENSIONS));
  }

  if (provider === "ollama") {
    const raw = await ollamaEmbed(texts, config);
    return raw.map((vector) => {
      const normalized = l2Normalize(vector);
      return normalized ? padToStorageDimensions(normalized) : null;
    });
  }

  if (provider === "bge") {
    const pipe = await getBgePipeline(config.embedding.model);
    const inputs = opts.isQuery ? texts.map((text) => `${BGE_QUERY_PREFIX}${text}`) : texts;
    const output = await pipe(inputs, { pooling: "mean", normalize: true });
    const [batch, dims] = output.dims.length === 2 ? output.dims : [1, output.dims[0]];
    const data = output.data;
    const results = [];
    for (let row = 0; row < batch; row += 1) {
      const vector = Array.from(data.slice(row * dims, (row + 1) * dims));
      results.push(padToStorageDimensions(vector));
    }
    return results;
  }

  throw new Error(`Unknown EMBEDDING_PROVIDER: ${provider}`);
}

/**
 * Embed a single text. Convenience wrapper over embedTexts.
 *
 * @param {string} text
 * @param {{ isQuery?: boolean, config?: ReturnType<typeof getRagConfig> }} [opts]
 * @returns {Promise<number[] | null>}
 */
export async function embedText(text, opts = {}) {
  const [vector] = await embedTexts([text], opts);
  return vector ?? null;
}

/** Human-readable descriptor of the active embedding provider (for traces/eval). */
export function describeEmbeddingProvider(config = getRagConfig()) {
  if (config.embedding.provider === "local") {
    return { provider: "local", model: "deterministic-hash-v1", dimensions: STORAGE_DIMENSIONS };
  }
  return {
    provider: config.embedding.provider,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  };
}
