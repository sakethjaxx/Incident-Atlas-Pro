/**
 * @pkg/nlp — retrieval score fusion
 *
 * Reciprocal Rank Fusion (RRF) over candidate lists from different backends
 * (Postgres full-text search, pgvector ANN, TurboQuant approximate scan).
 *
 * RRF is rank-based, so it needs no score normalization across backends:
 *   fused(d) = Σ_lists weight_l / (k + rank_l(d))
 *
 * k = 60 is the standard constant from the original RRF paper.
 */

export const RRF_K = 60;

/**
 * Fuse ranked candidate lists with Reciprocal Rank Fusion.
 *
 * @param {Array<{ name: string, weight?: number, items: Array<{ id: string, score?: number }> }>} lists
 *   Each list must already be sorted best-first; `score` is optional and kept for traces.
 * @param {{ k?: number }} [opts]
 * @returns {Array<{ id: string, fusedScore: number, sources: Record<string, { rank: number, score: number | null }> }>}
 *   Sorted descending by fusedScore.
 */
export function rrfFuse(lists, opts = {}) {
  const k = opts.k ?? RRF_K;
  const byId = new Map();

  for (const list of lists) {
    const weight = list.weight ?? 1;
    list.items.forEach((item, index) => {
      if (!item?.id) return;
      let entry = byId.get(item.id);
      if (!entry) {
        entry = { id: item.id, fusedScore: 0, sources: {} };
        byId.set(item.id, entry);
      }
      // Keep the best (lowest) rank if the same id appears twice in one list.
      if (!entry.sources[list.name] || entry.sources[list.name].rank > index + 1) {
        entry.sources[list.name] = {
          rank: index + 1,
          score: Number.isFinite(item.score) ? Number(item.score) : null,
        };
        entry.fusedScore += weight / (k + index + 1);
      }
    });
  }

  return [...byId.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}

/**
 * Build a per-candidate retrieval trace for debug/eval responses.
 *
 * @param {{ id: string, fusedScore: number, sources: Record<string, {rank: number, score: number|null}> }} fused
 * @param {{ backend: string, rerankScore?: number | null }} extras
 */
export function buildRetrievalTrace(fused, extras) {
  return {
    id: fused.id,
    backend: extras.backend,
    keywordRank: fused.sources.keyword?.rank ?? null,
    keywordScore: fused.sources.keyword?.score ?? null,
    vectorRank: fused.sources.vector?.rank ?? null,
    vectorScore: fused.sources.vector?.score ?? null,
    turboquantRank: fused.sources.turboquant?.rank ?? null,
    turboquantScore: fused.sources.turboquant?.score ?? null,
    fusedScore: Number(fused.fusedScore.toFixed(6)),
    rerankScore: extras.rerankScore ?? null,
  };
}
