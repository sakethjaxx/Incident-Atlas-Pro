#!/usr/bin/env node
/**
 * Incident Atlas Pro — retrieval + QA benchmark harness.
 *
 * Modes:
 *   node scripts/benchmark.mjs                  # fixture mode (default): no DB,
 *                                               # no network — pure in-process
 *                                               # benchmark of the retrieval math
 *   node scripts/benchmark.mjs --mode live      # end-to-end against a running
 *                                               # API (DB + migrations required)
 *
 * Fixture mode measures, over fixtures/bench/{incidents,queries}.json:
 *   • ingestion/chunking + embedding/indexing time, chunks/sec
 *   • search latency p50/p95 per backend
 *   • recall@5, recall@10, MRR, nDCG@10 per backend:
 *       keyword | vector-exact (pgvector-equivalent) | turboquant-raw |
 *       turboquant-verified | hybrid-rrf | hybrid-rrf+turboquant
 *   • TurboQuant recall delta vs the exact vector baseline
 *   • TurboQuant memory/index-size reduction vs float32
 *   • QA (local extractive simulation): latency p50/p95, citation precision,
 *     refusal accuracy
 *
 * Live mode replays the same fixtures through POST /ingest/manual, GET /search
 * and POST /qa, reporting end-to-end latency, recall and QA quality. Requires:
 *   API_URL (default http://localhost:3001) and ADMIN_TOKEN (default dev-secret).
 *
 * Output: console summary + JSON artifact under artifacts/bench/ (gitignored).
 *
 * Environment knobs respected in fixture mode: EMBEDDING_PROVIDER,
 * TURBOQUANT_BITS, TURBOQUANT_ROTATION, TURBOQUANT_RESIDUAL_QJL, TURBOQUANT_SEED.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  embedTexts,
  getRagConfig,
  cosineSimilarity,
  buildChunksForIncident,
  buildChunkEmbeddingText,
  tokenOverlapScore,
  rrfFuse,
  quantizeVector,
  prepareQuery,
  scanCodes,
  compressedSizeBytes,
  tokenizeForRetrieval,
} from "../packages/nlp/src/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// ── CLI / config ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const MODE = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "fixture";
const API_URL = (process.env.API_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "dev-secret";

const CONFIG = getRagConfig();
const TQ = {
  bits: CONFIG.turboquant.bits,
  rotation: CONFIG.turboquant.rotation,
  seed: CONFIG.turboquant.seed,
  residualQjl: CONFIG.turboquant.residualQjl,
};

// Mirrors qa.js gating constants for the fixture-mode QA simulation.
const QA_MIN_SCORE = 0.25;
const UNSAFE_RE = /ignore (all )?(previous|prior|above) (instructions|rules)|without citations?|system prompt/i;

// ── Metric helpers (mirrors apps/api/src/lib/eval.js) ─────────────────────────

const round = (v) => (Number.isFinite(v) ? Number(v.toFixed(4)) : null);

function recallAtK(expected, retrieved, k) {
  if (expected.length === 0) return null;
  const top = new Set(retrieved.slice(0, k));
  return round(expected.filter((id) => top.has(id)).length / expected.length);
}

function mrr(expected, retrieved) {
  if (expected.length === 0) return null;
  const set = new Set(expected);
  const index = retrieved.findIndex((id) => set.has(id));
  return index === -1 ? 0 : round(1 / (index + 1));
}

function ndcgAtK(expected, retrieved, k) {
  if (expected.length === 0) return null;
  const set = new Set(expected);
  let dcg = 0;
  retrieved.slice(0, k).forEach((id, i) => {
    if (set.has(id)) dcg += 1 / Math.log2(i + 2);
  });
  let ideal = 0;
  for (let i = 0; i < Math.min(set.size, k); i += 1) ideal += 1 / Math.log2(i + 2);
  return ideal === 0 ? null : round(dcg / ideal);
}

function average(values) {
  const xs = values.filter((v) => v !== null && Number.isFinite(v));
  return xs.length === 0 ? null : round(xs.reduce((s, v) => s + v, 0) / xs.length);
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return round(sorted[Math.max(0, index)]);
}

// ── Fixture loading ────────────────────────────────────────────────────────────

async function loadFixtures() {
  const incidents = JSON.parse(
    await readFile(path.join(ROOT, "fixtures/bench/10k_incidents.json"), "utf-8")
  ).incidents;
  const queries = JSON.parse(
    await readFile(path.join(ROOT, "fixtures/bench/queries.json"), "utf-8")
  ).queries;

  // Assign stable synthetic ids
  for (const incident of incidents) {
    incident.id = `inc-${incident.key}`;
    incident.sections = incident.sections.map((section, i) => ({
      ...section,
      id: `${incident.key}-s${i}`,
    }));
  }
  return { incidents, queries };
}

function buildRawText(incident) {
  const label = { impact: "Impact", timeline: "Timeline", rootcause: "Root cause", fix: "Fix" };
  return incident.sections
    .map((section) => `${label[section.type] ?? section.type}:\n${section.text}`)
    .join("\n\n");
}

// ── Fixture mode ───────────────────────────────────────────────────────────────

async function runFixtureMode() {
  const { incidents, queries } = await loadFixtures();
  const answerable = queries.filter((q) => !q.expectRefusal);
  const refusals = queries.filter((q) => q.expectRefusal);

  // 1. Chunking + embedding (ingestion proxy)
  const t0 = performance.now();
  const chunks = incidents.flatMap((incident) => buildChunksForIncident(incident));
  const chunkTexts = chunks.map((chunk, i) => {
    const incident = incidents.find((inc) => inc.id === chunk.incidentId);
    return buildChunkEmbeddingText(chunk, { title: incident.title, company: incident.company });
  });
  const tChunked = performance.now();
  const vectors = await embedTexts(chunkTexts, { config: CONFIG });
  const tEmbedded = performance.now();

  // 2. TurboQuant index build
  const tqEntries = [];
  let compressedBytes = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    if (!vectors[i]) continue;
    const quantized = quantizeVector(vectors[i], TQ);
    if (!quantized) continue;
    tqEntries.push({ id: i, ...quantized });
    compressedBytes += compressedSizeBytes(quantized) + 48; // + per-entry meta overhead
  }
  const tQuantized = performance.now();

  const float32Bytes = vectors.filter(Boolean).length * vectors.find(Boolean).length * 4;

  // 3. Per-backend retrieval functions (chunk index → ranked incident ids)
  const toIncidents = (chunkRank) => {
    const seen = new Set();
    const out = [];
    for (const index of chunkRank) {
      const id = chunks[index].incidentId;
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  };

  const backends = {
    keyword: (queryText) =>
      chunks
        .map((chunk, i) => ({ i, score: tokenOverlapScore(queryText, chunk.text) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.i),

    "vector-exact": (queryText, queryVector) =>
      vectors
        .map((vector, i) => ({ i, score: vector ? cosineSimilarity(queryVector, vector) : -1 }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.i),

    "turboquant-raw": (queryText, queryVector) => {
      const prepared = prepareQuery(queryVector, TQ);
      return scanCodes(prepared, tqEntries, 50).map((r) => r.id);
    },

    "turboquant-verified": (queryText, queryVector) => {
      const prepared = prepareQuery(queryVector, TQ);
      const candidates = scanCodes(prepared, tqEntries, 50).map((r) => r.id);
      return candidates
        .map((i) => ({ i, score: vectors[i] ? cosineSimilarity(queryVector, vectors[i]) : -1 }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.i);
    },
  };

  const fuseBackends = {
    "hybrid-rrf": ["keyword", "vector-exact"],
    "hybrid-rrf-turboquant": ["keyword", "turboquant-verified"],
  };

  const backendResults = {};
  const allNames = [...Object.keys(backends), ...Object.keys(fuseBackends)];
  for (const name of allNames) {
    backendResults[name] = { latencies: [], perQuery: [] };
  }

  // Pre-embed queries once (shared across backends; latency measured per backend on scoring)
  const queryVectors = await embedTexts(
    answerable.map((q) => q.question),
    { isQuery: true, config: CONFIG }
  );

  for (let qi = 0; qi < answerable.length; qi += 1) {
    const query = answerable[qi];
    const expected = query.expectedIncidentKeys.map((key) => `inc-${key}`);
    const queryVector = queryVectors[qi];
    const ranked = {};

    for (const [name, fn] of Object.entries(backends)) {
      const start = performance.now();
      const chunkRank = fn(query.question, queryVector);
      backendResults[name].latencies.push(performance.now() - start);
      ranked[name] = chunkRank;
      const incidentsRanked = toIncidents(chunkRank);
      backendResults[name].perQuery.push({
        recallAt5: recallAtK(expected, incidentsRanked, 5),
        recallAt10: recallAtK(expected, incidentsRanked, 10),
        mrr: mrr(expected, incidentsRanked),
        ndcgAt10: ndcgAtK(expected, incidentsRanked, 10),
      });
    }

    for (const [name, parts] of Object.entries(fuseBackends)) {
      const start = performance.now();
      const fused = rrfFuse(
        parts.map((part) => ({
          name: part,
          items: ranked[part].slice(0, 50).map((i) => ({ id: String(i) })),
        }))
      ).map((f) => Number(f.id));
      backendResults[name].latencies.push(performance.now() - start);
      const incidentsRanked = toIncidents(fused);
      backendResults[name].perQuery.push({
        recallAt5: recallAtK(expected, incidentsRanked, 5),
        recallAt10: recallAtK(expected, incidentsRanked, 10),
        mrr: mrr(expected, incidentsRanked),
        ndcgAt10: ndcgAtK(expected, incidentsRanked, 10),
      });
    }
  }

  // 4. QA simulation (local extractive pipeline: hybrid retrieval + gate + citations)
  const qaLatencies = [];
  let citationsTotal = 0;
  let citationsCorrect = 0;
  let refusalsCorrect = 0;
  let answeredCount = 0;

  const simulateQa = async (query) => {
    const start = performance.now();
    let result;
    if (UNSAFE_RE.test(query.question)) {
      result = { status: "refused" };
    } else {
      const [queryVector] = await embedTexts([query.question], { isQuery: true, config: CONFIG });
      const keywordRank = backends.keyword(query.question).slice(0, 50);
      const vectorRank = backends["vector-exact"](query.question, queryVector).slice(0, 50);
      const fused = rrfFuse([
        { name: "keyword", items: keywordRank.map((i) => ({ id: String(i) })) },
        { name: "vector", items: vectorRank.map((i) => ({ id: String(i) })) },
      ])
        .slice(0, 8)
        .map((f) => Number(f.id));

      const queryTokens = new Set(tokenizeForRetrieval(query.question));
      const strong = fused.filter((i) => {
        const cosine = vectors[i] ? cosineSimilarity(queryVector, vectors[i]) : 0;
        const overlap = tokenizeForRetrieval(chunks[i].text).some((t) => queryTokens.has(t));
        return cosine >= QA_MIN_SCORE && overlap;
      });
      result =
        strong.length === 0
          ? { status: "refused" }
          : { status: "answered", citations: strong.slice(0, 3).map((i) => chunks[i].incidentId) };
    }
    qaLatencies.push(performance.now() - start);
    return result;
  };

  for (const query of answerable) {
    const result = await simulateQa(query);
    if (result.status === "answered") {
      answeredCount += 1;
      const expected = new Set(query.expectedIncidentKeys.map((key) => `inc-${key}`));
      for (const incidentId of result.citations) {
        citationsTotal += 1;
        if (expected.has(incidentId)) citationsCorrect += 1;
      }
    }
  }
  for (const query of refusals) {
    const result = await simulateQa(query);
    if (result.status === "refused") refusalsCorrect += 1;
  }

  // 5. Aggregate report
  const aggregate = (name) => {
    const rows = backendResults[name].perQuery;
    return {
      recallAt5: average(rows.map((r) => r.recallAt5)),
      recallAt10: average(rows.map((r) => r.recallAt10)),
      mrr: average(rows.map((r) => r.mrr)),
      ndcgAt10: average(rows.map((r) => r.ndcgAt10)),
      latencyMsP50: percentile(backendResults[name].latencies, 50),
      latencyMsP95: percentile(backendResults[name].latencies, 95),
    };
  };

  const perBackend = Object.fromEntries(allNames.map((name) => [name, aggregate(name)]));
  const exact = perBackend["vector-exact"];
  const tqVerified = perBackend["turboquant-verified"];
  const tqRaw = perBackend["turboquant-raw"];

  const report = {
    mode: "fixture",
    createdAt: new Date().toISOString(),
    config: {
      embedding: CONFIG.embedding,
      turboquant: { ...TQ },
      retrievalBackend: CONFIG.retrieval.backend,
    },
    dataset: {
      incidents: incidents.length,
      chunks: chunks.length,
      queries: queries.length,
      answerable: answerable.length,
      refusalQueries: refusals.length,
    },
    ingestion: {
      chunkingMs: round(tChunked - t0),
      embeddingMs: round(tEmbedded - tChunked),
      turboquantIndexMs: round(tQuantized - tEmbedded),
      chunksPerSecond: round(chunks.length / ((tEmbedded - t0) / 1000)),
    },
    retrieval: perBackend,
    turboquant: {
      recallAt5DeltaVsExact: round((tqVerified.recallAt5 ?? 0) - (exact.recallAt5 ?? 0)),
      recallAt10DeltaVsExact: round((tqVerified.recallAt10 ?? 0) - (exact.recallAt10 ?? 0)),
      rawRecallAt5DeltaVsExact: round((tqRaw.recallAt5 ?? 0) - (exact.recallAt5 ?? 0)),
      float32IndexBytes: float32Bytes,
      compressedIndexBytes: compressedBytes,
      memoryReductionFactor: round(float32Bytes / Math.max(1, compressedBytes)),
    },
    qa: {
      pipeline: "local-extractive-simulation",
      latencyMsP50: percentile(qaLatencies, 50),
      latencyMsP95: percentile(qaLatencies, 95),
      answeredRate: round(answeredCount / Math.max(1, answerable.length)),
      citationPrecision: citationsTotal === 0 ? null : round(citationsCorrect / citationsTotal),
      refusalAccuracy: round(refusalsCorrect / Math.max(1, refusals.length)),
    },
  };

  return report;
}

// ── Live mode ──────────────────────────────────────────────────────────────────

async function api(pathname, options = {}) {
  const res = await fetch(`${API_URL}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(options.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function runLiveMode() {
  const { incidents, queries } = await loadFixtures();

  const health = await api("/health").catch(() => null);
  if (!health || health.status >= 500) {
    throw new Error(
      `API unreachable at ${API_URL} — start it with: pnpm db:up && pnpm api:migrate && pnpm dev`
    );
  }

  // Ingest fixtures
  const idByKey = new Map();
  const ingestLatencies = [];
  for (const incident of incidents) {
    const start = performance.now();
    const { status, body } = await api("/ingest/manual", {
      method: "POST",
      body: JSON.stringify({
        title: incident.title,
        company: incident.company,
        severity: incident.severity,
        tags: incident.tags,
        rawText: buildRawText(incident),
      }),
    });
    ingestLatencies.push(performance.now() - start);
    if (status !== 201) {
      throw new Error(`ingest failed for ${incident.key}: ${status} ${JSON.stringify(body)}`);
    }
    idByKey.set(incident.key, body.id);
  }

  const answerable = queries.filter((q) => !q.expectRefusal);
  const refusals = queries.filter((q) => q.expectRefusal);

  // Search benchmarks
  const searchLatencies = [];
  const perQuery = [];
  for (const query of answerable) {
    const expected = query.expectedIncidentKeys.map((key) => idByKey.get(key)).filter(Boolean);
    const start = performance.now();
    const { body } = await api(`/search?q=${encodeURIComponent(query.question)}&limit=10`);
    searchLatencies.push(performance.now() - start);
    const retrieved = (body.results ?? []).map((r) => r.incident?.id).filter(Boolean);
    perQuery.push({
      recallAt5: recallAtK(expected, retrieved, 5),
      recallAt10: recallAtK(expected, retrieved, 10),
      mrr: mrr(expected, retrieved),
      ndcgAt10: ndcgAtK(expected, retrieved, 10),
    });
  }

  // QA benchmarks
  const qaLatencies = [];
  let citationsTotal = 0;
  let citationsCorrect = 0;
  let answered = 0;
  for (const query of answerable) {
    const expected = new Set(
      query.expectedIncidentKeys.map((key) => idByKey.get(key)).filter(Boolean)
    );
    const start = performance.now();
    const { body } = await api("/qa", {
      method: "POST",
      body: JSON.stringify({ question: query.question }),
    });
    qaLatencies.push(performance.now() - start);
    if (body.status === "answered") {
      answered += 1;
      for (const citation of body.citations ?? []) {
        citationsTotal += 1;
        if (expected.has(citation.incidentId)) citationsCorrect += 1;
      }
    }
  }

  let refusalsCorrect = 0;
  for (const query of refusals) {
    const { body } = await api("/qa", {
      method: "POST",
      body: JSON.stringify({ question: query.question }),
    });
    if (body.status === "refused") refusalsCorrect += 1;
  }

  return {
    mode: "live",
    apiUrl: API_URL,
    createdAt: new Date().toISOString(),
    dataset: { incidents: incidents.length, queries: queries.length },
    ingestion: {
      latencyMsP50: percentile(ingestLatencies, 50),
      latencyMsP95: percentile(ingestLatencies, 95),
      incidentsPerSecond: round(
        incidents.length / (ingestLatencies.reduce((s, v) => s + v, 0) / 1000)
      ),
    },
    search: {
      latencyMsP50: percentile(searchLatencies, 50),
      latencyMsP95: percentile(searchLatencies, 95),
      recallAt5: average(perQuery.map((r) => r.recallAt5)),
      recallAt10: average(perQuery.map((r) => r.recallAt10)),
      mrr: average(perQuery.map((r) => r.mrr)),
      ndcgAt10: average(perQuery.map((r) => r.ndcgAt10)),
    },
    qa: {
      latencyMsP50: percentile(qaLatencies, 50),
      latencyMsP95: percentile(qaLatencies, 95),
      answeredRate: round(answered / Math.max(1, answerable.length)),
      citationPrecision: citationsTotal === 0 ? null : round(citationsCorrect / citationsTotal),
      refusalAccuracy: round(refusalsCorrect / Math.max(1, refusals.length)),
    },
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[bench] mode=${MODE} embedding=${CONFIG.embedding.provider} tq=${JSON.stringify(TQ)}`);

  const report = MODE === "live" ? await runLiveMode() : await runFixtureMode();

  const outDir = path.join(ROOT, "artifacts", "bench");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(
    outDir,
    `bench-${MODE}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  console.log(JSON.stringify(report, null, 2));
  console.log(`\n[bench] report written to ${path.relative(ROOT, outFile)}`);
}

main().catch((error) => {
  console.error(`[bench] FAILED: ${error.message}`);
  process.exit(1);
});
