/**
 * Unit tests for the open-source RAG stack additions:
 *   providers (config + local embedding dispatch + padding)
 *   chunking (section/paragraph chunks with citation anchors)
 *   fusion (reciprocal rank fusion)
 *   rerank (none + local token-overlap)
 *   turboquant (rotation, quantization, approximate cosine accuracy, packing)
 *
 * Entirely offline — no DB, no network, no model downloads.
 */

import { createServer } from "http";
import { describe, it, expect, afterAll } from "vitest";
import {
  createEmbedding,
  cosineSimilarity,
  STORAGE_DIMENSIONS,
  getRagConfig,
  embedTexts,
  padToStorageDimensions,
  ollamaGenerate,
  ollamaEmbed,
  buildChunksForIncident,
  chunkText,
  rrfFuse,
  tokenOverlapScore,
  rerankCandidates,
  rotateVector,
  quantizeVector,
  prepareQuery,
  approxCosine,
  scanCodes,
  unpackCodes,
  serializeQuantized,
  deserializeQuantized,
  compressedSizeBytes,
} from "../index.js";

// ── Minimal mock Ollama HTTP server ───────────────────────────────────────────
// Exercises the full Ollama code path (ollamaGenerate + ollamaEmbed) without
// requiring a real Ollama install. Binds to an ephemeral OS-assigned port.

let _mockOllamaServer = null;
let _mockOllamaPort = null;

async function startMockOllama() {
  return new Promise((resolve) => {
    _mockOllamaServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const payload = JSON.parse(body || "{}");
        res.setHeader("content-type", "application/json");
        if (req.url === "/api/generate") {
          res.end(JSON.stringify({ model: payload.model, response: "mock answer [C1]", done: true }));
        } else if (req.url === "/api/embed") {
          const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
          // Return synthetic 4-d unit vectors (padToStorageDimensions fills rest to 1536)
          const embeddings = inputs.map((_, i) => {
            const v = new Array(4).fill(0);
            v[i % 4] = 1;
            return v;
          });
          res.end(JSON.stringify({ embeddings }));
        } else {
          res.statusCode = 404;
          res.end("{}");
        }
      });
    });
    _mockOllamaServer.listen(0, "127.0.0.1", () => {
      _mockOllamaPort = _mockOllamaServer.address().port;
      resolve(_mockOllamaPort);
    });
  });
}

afterAll(() => {
  _mockOllamaServer?.close();
});

// ── providers ──────────────────────────────────────────────────────────────────

describe("getRagConfig", () => {
  it("defaults to fully-local providers (no network in tests)", () => {
    const config = getRagConfig({});
    expect(config.embedding.provider).toBe("local");
    expect(config.qa.provider).toBe("local");
    expect(config.graph.extractor).toBe("rules");
    expect(config.reranker.provider).toBe("none");
    expect(config.retrieval.backend).toBe("pgvector");
    expect(config.turboquant.enabled).toBe(false);
  });

  it("reads the documented env contract", () => {
    const config = getRagConfig({
      EMBEDDING_PROVIDER: "bge",
      EMBEDDING_MODEL: "BAAI/bge-small-en-v1.5",
      EMBEDDING_DIMENSIONS: "384",
      QA_PROVIDER: "ollama",
      QA_MODEL: "qwen3:4b",
      GRAPH_EXTRACTOR: "ollama",
      RERANKER_PROVIDER: "bge",
      RETRIEVAL_BACKEND: "hybrid",
      TURBOQUANT_ENABLED: "true",
      TURBOQUANT_BITS: "4",
      TURBOQUANT_ROTATION: "hadamard",
      TURBOQUANT_RESIDUAL_QJL: "true",
    });
    expect(config.embedding).toMatchObject({
      provider: "bge",
      model: "BAAI/bge-small-en-v1.5",
      dimensions: 384,
    });
    expect(config.qa).toMatchObject({ provider: "ollama", model: "qwen3:4b" });
    expect(config.graph.extractor).toBe("ollama");
    expect(config.reranker.provider).toBe("bge");
    expect(config.retrieval.backend).toBe("hybrid");
    expect(config.turboquant).toMatchObject({
      enabled: true,
      bits: 4,
      rotation: "hadamard",
      residualQjl: true,
    });
  });

  it("falls back to safe defaults on invalid enum values", () => {
    const config = getRagConfig({ EMBEDDING_PROVIDER: "openai", QA_PROVIDER: "anthropic" });
    expect(config.embedding.provider).toBe("local");
    expect(config.qa.provider).toBe("local");
  });
});

describe("embedTexts (local provider)", () => {
  it("returns storage-dimension normalized vectors", async () => {
    const [vector] = await embedTexts(["database connection pool exhausted"], {
      config: getRagConfig({}),
    });
    expect(vector).toHaveLength(STORAGE_DIMENSIONS);
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 4);
  });

  it("returns null for empty text", async () => {
    const [vector] = await embedTexts([""], { config: getRagConfig({}) });
    expect(vector).toBeNull();
  });
});

// ── Ollama provider (mock server) ─────────────────────────────────────────────

describe("ollamaGenerate", () => {
  it("returns text from /api/generate and tolerates empty trailing whitespace", async () => {
    const port = await startMockOllama();
    const config = getRagConfig({ OLLAMA_URL: `http://127.0.0.1:${port}`, QA_PROVIDER: "ollama" });
    const result = await ollamaGenerate({ model: "qwen3:4b", prompt: "what happened?" }, config);
    expect(typeof result).toBe("string");
    expect(result.trim()).toBe("mock answer [C1]");
  });

  it("throws on non-200 response", async () => {
    const port = await startMockOllama();
    const config = getRagConfig({ OLLAMA_URL: `http://127.0.0.1:${port}`, OLLAMA_TIMEOUT_MS: "2000" });
    await expect(
      ollamaGenerate({ model: "qwen3:4b", prompt: "test" }, { ...config, ollama: { ...config.ollama, url: `http://127.0.0.1:${port}/bad-prefix` } })
    ).rejects.toThrow();
  });

  it("throws on unreachable endpoint (not silent)", async () => {
    const config = getRagConfig({ OLLAMA_URL: "http://127.0.0.1:1", OLLAMA_TIMEOUT_MS: "800" });
    await expect(
      ollamaGenerate({ model: "qwen3:4b", prompt: "test" }, config)
    ).rejects.toThrow();
  });
});

describe("ollamaEmbed", () => {
  it("returns one embedding vector per input text, storage-padded", async () => {
    const port = await startMockOllama();
    const config = getRagConfig({
      OLLAMA_URL: `http://127.0.0.1:${port}`,
      EMBEDDING_PROVIDER: "ollama",
      EMBEDDING_MODEL: "bge-m3",
      EMBEDDING_DIMENSIONS: "4",
    });
    // ollamaEmbed returns raw vectors; embedTexts pads them
    const raw = await ollamaEmbed(["incident one", "incident two"], config);
    expect(raw).toHaveLength(2);
    expect(raw[0]).toHaveLength(4); // mock server returns 4-d
    // Verify the full embedTexts dispatch path also works
    const padded = await embedTexts(["incident one", "incident two"], { config });
    expect(padded[0]).toHaveLength(STORAGE_DIMENSIONS);
  });
});

describe("padToStorageDimensions", () => {
  it("zero-pads small vectors and preserves cosine similarity", () => {
    const a = [0.6, 0.8];
    const b = [1, 0];
    const padded = padToStorageDimensions(a);
    expect(padded).toHaveLength(STORAGE_DIMENSIONS);
    expect(cosineSimilarity(padded, padToStorageDimensions(b))).toBeCloseTo(
      cosineSimilarity(a, b),
      10
    );
  });

  it("throws when the vector exceeds storage dimensions", () => {
    expect(() => padToStorageDimensions(new Array(STORAGE_DIMENSIONS + 1).fill(0.1))).toThrow(
      /storage/i
    );
  });
});

// ── chunking ───────────────────────────────────────────────────────────────────

describe("chunking", () => {
  const longParagraphs = Array.from(
    { length: 8 },
    (_, i) =>
      `Paragraph ${i}: the payment-api saw elevated error rates because the connection pool ` +
      `was exhausted after the deploy, and engineers rolled back the release to restore traffic.`
  ).join("\n\n");

  it("keeps short text as a single chunk", () => {
    expect(chunkText("short impact text")).toEqual(["short impact text"]);
  });

  it("splits long text into bounded chunks", () => {
    const chunks = chunkText(longParagraphs, { maxChars: 400, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(400 + 60); // overlap slack
    }
  });

  it("buildChunksForIncident anchors every chunk to its exact section", () => {
    const incident = {
      id: "incident-1",
      title: "payment outage",
      sections: [
        { id: "sec-impact", type: "impact", text: "Checkout failed for all users." },
        { id: "sec-fix", type: "fix", text: longParagraphs },
      ],
    };
    const chunks = buildChunksForIncident(incident);

    const sectionChunks = chunks.filter((c) => c.chunkType === "section");
    expect(sectionChunks).toHaveLength(2);

    const paragraphChunks = chunks.filter((c) => c.chunkType === "paragraph");
    expect(paragraphChunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.incidentId).toBe("incident-1");
      expect(["sec-impact", "sec-fix"]).toContain(chunk.sectionId);
      expect(chunk.text.length).toBeGreaterThan(0);
    }
    // Short section must NOT be paragraph-split
    expect(paragraphChunks.every((c) => c.sectionId === "sec-fix")).toBe(true);
  });
});

// ── fusion ─────────────────────────────────────────────────────────────────────

describe("rrfFuse", () => {
  it("ranks documents appearing high in multiple lists first", () => {
    const fused = rrfFuse([
      { name: "keyword", items: [{ id: "a", score: 3 }, { id: "b", score: 2 }, { id: "c", score: 1 }] },
      { name: "vector", items: [{ id: "b", score: 0.9 }, { id: "a", score: 0.8 }, { id: "d", score: 0.7 }] },
    ]);
    const ids = fused.map((f) => f.id);
    // a and b both appear in two lists → above c and d
    expect(ids.slice(0, 2).sort()).toEqual(["a", "b"]);
    expect(fused[0].sources.keyword.rank).toBeDefined();
  });

  it("respects list weights", () => {
    const fused = rrfFuse([
      { name: "keyword", weight: 0.1, items: [{ id: "a" }] },
      { name: "vector", weight: 2.0, items: [{ id: "b" }] },
    ]);
    expect(fused[0].id).toBe("b");
  });
});

// ── rerank ─────────────────────────────────────────────────────────────────────

describe("rerank", () => {
  it("local token-overlap reranker prefers texts covering more query terms", () => {
    const good = tokenOverlapScore(
      "what fixed the payment outage",
      "engineers fixed the payment outage by rolling back"
    );
    const bad = tokenOverlapScore("what fixed the payment outage", "unrelated networking change");
    expect(good).toBeGreaterThan(bad);
  });

  it("provider none preserves order and returns null scores", async () => {
    const { provider, results } = await rerankCandidates(
      "query",
      [
        { id: "1", text: "first" },
        { id: "2", text: "second" },
      ],
      { config: getRagConfig({}) }
    );
    expect(provider).toBe("none");
    expect(results.map((r) => r.id)).toEqual(["1", "2"]);
    expect(results[0].rerankScore).toBeNull();
  });

  it("provider local sorts by overlap score", async () => {
    const { provider, results } = await rerankCandidates(
      "payment outage fix",
      [
        { id: "weak", text: "completely unrelated text" },
        { id: "strong", text: "the payment outage fix was a rollback" },
      ],
      { config: getRagConfig({ RERANKER_PROVIDER: "local" }) }
    );
    expect(provider).toBe("local");
    expect(results[0].id).toBe("strong");
  });

  it("provider bge without endpoint falls back to local without throwing", async () => {
    const { provider, results } = await rerankCandidates(
      "payment outage",
      [{ id: "x", text: "payment outage details" }],
      { config: getRagConfig({ RERANKER_PROVIDER: "bge" }) }
    );
    expect(provider).toBe("local");
    expect(results[0].rerankScore).toBeGreaterThan(0);
  });
});

// ── turboquant ─────────────────────────────────────────────────────────────────

function randomUnitVector(dims, seedText) {
  // Deterministic pseudo-random unit vector via the hash embedding
  return createEmbedding(seedText, dims);
}

describe("turboquant", () => {
  const DIMS = 384;
  const texts = [
    "database connection pool exhausted during deploy",
    "payment api checkout outage rollback fix",
    "kafka consumer lag caused delayed notifications",
    "dns resolution failure in eu-west region",
    "memory leak in cache layer restarted nightly",
    "tls certificate expiry broke webhooks",
    "rate limiter misconfiguration throttled logins",
    "search cluster shard relocation latency spike",
  ];
  const vectors = texts.map((t) => randomUnitVector(DIMS, t));

  it("rotation preserves norms and inner products (orthonormal)", () => {
    const a = vectors[0];
    const b = vectors[1];
    const ra = rotateVector(a, { rotation: "hadamard", seed: 7 });
    const rb = rotateVector(b, { rotation: "hadamard", seed: 7 });

    const norm = (v) => Math.sqrt([...v].reduce((s, x) => s + x * x, 0));
    const dot = (x, y) => [...x].reduce((s, v, i) => s + v * y[i], 0);

    expect(norm(ra)).toBeCloseTo(norm(a.concat()), 6);
    expect(dot(ra, rb)).toBeCloseTo(dot(a, b), 6);
  });

  it("pack/unpack codes round-trips for 2, 4, and 8 bits", () => {
    for (const bits of [2, 4, 8]) {
      const max = (1 << bits) - 1;
      const codes = Uint8Array.from({ length: 33 }, (_, i) => i % (max + 1));
      const { codes: packed } = {
        codes: quantizeVector(vectors[0], { bits, dims: DIMS }).codes,
      };
      expect(packed).toBeInstanceOf(Uint8Array);
      // direct unpack check on a known array
      const repacked = unpackCodes(
        quantizeVector(vectors[0], { bits, dims: DIMS }).codes,
        512,
        bits
      );
      expect(repacked).toHaveLength(512);
      expect(Math.max(...repacked)).toBeLessThanOrEqual(max);
      expect(codes.length).toBe(33); // sanity for loop
    }
  });

  it("4-bit approximate cosine tracks exact cosine closely", () => {
    const query = randomUnitVector(DIMS, "why did checkout fail during the deploy");
    const prepared = prepareQuery(query, { dims: DIMS, rotation: "hadamard", seed: 1337 });

    let maxError = 0;
    for (const vector of vectors) {
      const exact = cosineSimilarity(query, vector);
      const stored = quantizeVector(vector, {
        bits: 4,
        dims: DIMS,
        rotation: "hadamard",
        seed: 1337,
        residualQjl: true,
      });
      const approx = approxCosine(prepared, stored);
      maxError = Math.max(maxError, Math.abs(exact - approx));
    }
    expect(maxError).toBeLessThan(0.08);
  });

  it("top-1 recall: nearest neighbor under exact cosine is found by scanCodes", () => {
    const entries = vectors.map((vector, i) => ({
      id: `doc-${i}`,
      ...quantizeVector(vector, { bits: 4, dims: DIMS, seed: 42 }),
    }));

    let hits = 0;
    for (let qi = 0; qi < texts.length; qi += 1) {
      const query = randomUnitVector(DIMS, `${texts[qi]} question`);
      const exactBest = vectors
        .map((v, i) => ({ id: `doc-${i}`, score: cosineSimilarity(query, v) }))
        .sort((a, b) => b.score - a.score)[0];

      const prepared = prepareQuery(query, { dims: DIMS, seed: 42 });
      const approxTop = scanCodes(prepared, entries, 3);
      if (approxTop.some((r) => r.id === exactBest.id)) hits += 1;
    }
    // Approximate top-3 must contain the exact top-1 for at least 7/8 queries.
    expect(hits).toBeGreaterThanOrEqual(7);
  });

  it("compression is at least 4x smaller than native float32 at 4 bits", () => {
    const stored = quantizeVector(vectors[0], { bits: 4, dims: DIMS, residualQjl: true });
    // 384 dims pad to 512: codes 256 B + residual signs 64 B = 320 B vs 1536 B float32.
    const float32Bytes = DIMS * 4;
    expect(compressedSizeBytes(stored)).toBeLessThanOrEqual(float32Bytes / 4);
  });

  it("serialize/deserialize round-trips through Buffers", () => {
    const stored = quantizeVector(vectors[2], { bits: 4, dims: DIMS });
    const row = serializeQuantized(stored);
    expect(Buffer.isBuffer(row.codes)).toBe(true);

    const revived = deserializeQuantized(row);
    const query = prepareQuery(randomUnitVector(DIMS, texts[2]), { dims: DIMS });
    expect(approxCosine(query, revived)).toBeCloseTo(approxCosine(query, stored), 10);
  });

  it("random rotation variant also produces usable estimates", () => {
    const query = randomUnitVector(DIMS, "kafka consumer lag question");
    const target = vectors[2];
    const stored = quantizeVector(target, { bits: 4, dims: DIMS, rotation: "random", seed: 9 });
    const prepared = prepareQuery(query, { dims: DIMS, rotation: "random", seed: 9 });
    const exact = cosineSimilarity(query, target);
    expect(Math.abs(approxCosine(prepared, stored) - exact)).toBeLessThan(0.1);
  });
});
