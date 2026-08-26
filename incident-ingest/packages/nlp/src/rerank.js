/**
 * @pkg/nlp — reranker interface
 *
 * RERANKER_PROVIDER = none | local | bge
 *   none  → pass-through (rerankScore = null, order preserved)
 *   local → deterministic token-overlap scorer (offline, test-safe)
 *   bge   → BAAI/bge-reranker-base served over HTTP using the
 *           text-embeddings-inference (TEI) `/rerank` contract:
 *             POST { query, texts } → [{ index, score }, ...]
 *           Configure with RERANKER_URL. Falls back to `local` scoring on any
 *           network/endpoint failure so retrieval never breaks.
 *
 * Reranking happens over the top 30–50 fused candidates; callers then keep
 * the final 5–8 chunks for QA context.
 */

import { tokenizeForRetrieval } from "./index.js";
import { getRagConfig } from "./providers.js";

const BGE_RERANK_TIMEOUT_MS = 15_000;

/**
 * Deterministic lexical rerank score in [0, 1]:
 * fraction of distinct query tokens present in the candidate text, with a
 * small bonus for exact bigram hits.
 *
 * @param {string} query
 * @param {string} text
 * @returns {number}
 */
export function tokenOverlapScore(query, text) {
  const queryTokens = tokenizeForRetrieval(query);
  if (queryTokens.length === 0) return 0;
  const textTokens = tokenizeForRetrieval(text);
  if (textTokens.length === 0) return 0;

  const textSet = new Set(textTokens);
  const distinctQuery = [...new Set(queryTokens)];
  let hits = 0;
  for (const token of distinctQuery) {
    if (textSet.has(token)) hits += 1;
  }

  let bigramBonus = 0;
  const textJoined = ` ${textTokens.join(" ")} `;
  for (let i = 0; i < distinctQuery.length - 1; i += 1) {
    if (textJoined.includes(` ${distinctQuery[i]} ${distinctQuery[i + 1]} `)) {
      bigramBonus += 0.5;
    }
  }

  return Math.min(1, (hits + bigramBonus) / distinctQuery.length);
}

async function bgeRerank(query, candidates, config) {
  if (!config.reranker.url) {
    throw new Error(
      "RERANKER_PROVIDER=bge requires RERANKER_URL (a TEI endpoint serving BAAI/bge-reranker-base)"
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BGE_RERANK_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.reranker.url.replace(/\/+$/, "")}/rerank`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, texts: candidates.map((c) => c.text) }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`rerank endpoint returned ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("rerank endpoint returned a non-array");

    const scores = new Array(candidates.length).fill(0);
    for (const item of data) {
      if (Number.isInteger(item?.index) && item.index < scores.length) {
        scores[item.index] = Number(item.score) || 0;
      }
    }
    return scores;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rerank candidates with the configured provider.
 * Never throws — degrades: bge → local → none.
 *
 * @param {string} query
 * @param {Array<{ id: string, text: string }>} candidates  (already fused/sorted)
 * @param {{ config?: ReturnType<typeof getRagConfig> }} [opts]
 * @returns {Promise<{ provider: string, results: Array<{ id: string, rerankScore: number | null }> }>}
 *   `results` sorted best-first by rerankScore (or input order for `none`).
 */
export async function rerankCandidates(query, candidates, opts = {}) {
  const config = opts.config ?? getRagConfig();
  const provider = config.reranker.provider;

  if (provider === "none" || candidates.length === 0) {
    return {
      provider: "none",
      results: candidates.map((c) => ({ id: c.id, rerankScore: null })),
    };
  }

  if (provider === "bge") {
    try {
      const scores = await bgeRerank(query, candidates, config);
      return {
        provider: "bge",
        results: candidates
          .map((c, i) => ({ id: c.id, rerankScore: Number(scores[i].toFixed(6)) }))
          .sort((a, b) => b.rerankScore - a.rerankScore),
      };
    } catch (error) {
      console.warn("[rerank] bge reranker unavailable, falling back to local:", error?.message);
      // fall through to local
    }
  }

  return {
    provider: "local",
    results: candidates
      .map((c) => ({ id: c.id, rerankScore: Number(tokenOverlapScore(query, c.text).toFixed(6)) }))
      .sort((a, b) => b.rerankScore - a.rerankScore),
  };
}
