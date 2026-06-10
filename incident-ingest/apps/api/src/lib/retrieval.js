import {
  cosineSimilarity,
  createEmbedding,
  formatEmbeddingForSql,
  tokenizeForRetrieval,
  embedText,
  getRagConfig,
  describeEmbeddingProvider,
  rrfFuse,
  buildRetrievalTrace,
  rerankCandidates,
  prepareQuery,
  scanCodes,
  deserializeQuantized,
} from "@pkg/nlp";

const VECTOR_MATCH_THRESHOLD = 0.18;
const MAX_MATCHED_SECTIONS = 3;

// ── TurboQuant code cache ─────────────────────────────────────────────────────
// Loading ALL chunk codes from DB on every query is O(corpus) — fine at <100k
// chunks but wasteful on repeated queries. Cache the deserialized entries for
// the lifetime of the process; invalidate on any chunk write.
const _tqCache = {
  entries: /** @type {Array<{id:string,codes:Uint8Array,residual:Uint8Array|null,meta:object}>|null} */ (null),
  generation: 0,
};

/** Call after any write to the chunks table so the next TQ scan reloads. */
export function invalidateTqCache() {
  _tqCache.entries = null;
  _tqCache.generation += 1;
}

// ── Chunk retrieval configuration (Sprint 5) ─────────────────────────────────
export const CHUNK_RETRIEVAL = Object.freeze({
  /** Candidates pulled from each backend before fusion. */
  CANDIDATES_PER_BACKEND: 50,
  /** Fused candidates passed to the reranker. */
  RERANK_POOL: 40,
  /** Default number of evidence chunks returned to QA (5–8 recommended). */
  DEFAULT_LIMIT: 8,
  /** RRF weight for the keyword (FTS) list. */
  KEYWORD_WEIGHT: 1.0,
  /** RRF weight for the vector list. */
  VECTOR_WEIGHT: 1.0,
  /** RRF weight for the TurboQuant approximate list (experimental). */
  TURBOQUANT_WEIGHT: 0.9,
});

export function buildIncidentEmbeddingText(incident) {
  return [
    incident.title,
    incident.company,
    incident.severity,
    ...(incident.tags ?? []),
    ...(incident.products ?? []),
    incident.summaryText,
    ...(incident.sections ?? []).map((section) => `${section.type} ${section.text}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSectionEmbeddingText(section) {
  return `${section.type}\n${section.text}`;
}

export async function indexIncidentEmbeddings(client, incident) {
  const incidentVector = formatEmbeddingForSql(
    createEmbedding(buildIncidentEmbeddingText(incident))
  );

  if (incidentVector) {
    await client.$executeRawUnsafe(
      'UPDATE "incidents" SET "summary_embedding" = $1::vector WHERE "id" = $2::uuid',
      incidentVector,
      incident.id
    );
  }

  for (const section of incident.sections ?? []) {
    const sectionVector = formatEmbeddingForSql(
      createEmbedding(buildSectionEmbeddingText(section))
    );
    if (!sectionVector) continue;

    await client.$executeRawUnsafe(
      'UPDATE "sections" SET "embedding" = $1::vector WHERE "id" = $2::uuid',
      sectionVector,
      section.id
    );
  }
}

export async function safeIndexIncidentEmbeddings(client, incident) {
  try {
    await indexIncidentEmbeddings(client, incident);
    return true;
  } catch (error) {
    console.warn(
      `[retrieval] embedding index skipped for incidentId=${incident?.id}:`,
      error?.message ?? error
    );
    return false;
  }
}

export function normalizeSearchParams(query) {
  const q = String(query.q ?? "").trim();
  const page = clampInt(query.page, 1, 1, 10_000);
  const limit = clampInt(query.limit, 20, 1, 50);
  const filters = {
    company: stringParam(query.company ?? query.filter_company),
    severity: stringParam(query.severity ?? query.filter_severity),
    tag: stringParam(query.tag),
    from: dateParam(query.from),
    to: dateParam(query.to),
  };

  return { q, page, limit, skip: (page - 1) * limit, filters };
}

export async function searchIncidents(client, params) {
  const vectorResult = await searchWithPgvector(client, params);
  if (vectorResult && vectorResult.rows.length > 0) {
    return hydrateSearchRows(client, params, vectorResult.rows, vectorResult.total);
  }

  return searchLocally(client, params);
}

export async function findSimilarIncidents(client, incidentId, limit = 5) {
  const source = await client.incident.findUnique({
    where: { id: incidentId },
    include: { sections: { orderBy: { createdAt: "asc" } } },
  });

  if (!source) return null;

  const vectorRows = await similarWithPgvector(client, source, limit);
  if (vectorRows.length > 0) {
    const hydrated = await hydrateIncidents(client, vectorRows.map((row) => row.id));
    return vectorRows
      .map((row) => {
        const incident = hydrated.get(row.id);
        if (!incident) return null;
        return toSimilarResult(source, incident, Number(row.score));
      })
      .filter(Boolean);
  }

  const sourceEmbedding = createEmbedding(buildIncidentEmbeddingText(source));
  const candidates = await client.incident.findMany({
    where: { NOT: { id: incidentId } },
    include: { sections: { orderBy: { createdAt: "asc" } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return candidates
    .map((candidate) => ({
      incident: candidate,
      score: cosineSimilarity(
        sourceEmbedding,
        createEmbedding(buildIncidentEmbeddingText(candidate))
      ),
    }))
    .filter((item) => item.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => toSimilarResult(source, item.incident, item.score));
}

async function searchWithPgvector(client, params) {
  const queryEmbedding = formatEmbeddingForSql(createEmbedding(params.q));
  if (!queryEmbedding) return null;

  const sqlParams = [params.q, queryEmbedding];
  const filterSql = buildSqlFilters(params.filters, sqlParams);
  sqlParams.push(params.limit, params.skip);
  const limitIndex = sqlParams.length - 1;
  const offsetIndex = sqlParams.length;

  const sql = `
    WITH query AS (
      SELECT plainto_tsquery('english', $1) AS tsq, $2::vector AS embedding
    ),
    incident_scores AS (
      SELECT
        i."id",
        ts_rank_cd(
          to_tsvector(
            'english',
            coalesce(i."title", '') || ' ' ||
            coalesce(i."summary_text", '') || ' ' ||
            coalesce(i."company", '')
          ),
          query.tsq
        ) AS incident_keyword_score,
        CASE
          WHEN i."summary_embedding" IS NULL THEN 0
          ELSE GREATEST(0, 1 - (i."summary_embedding" <=> query.embedding))
        END AS incident_vector_score
      FROM "incidents" i
      CROSS JOIN query
      WHERE ${filterSql}
    ),
    section_scores AS (
      SELECT
        s."incident_id" AS "id",
        max(ts_rank_cd(to_tsvector('english', coalesce(s."text", '')), query.tsq)) AS section_keyword_score,
        max(
          CASE
            WHEN s."embedding" IS NULL THEN 0
            ELSE GREATEST(0, 1 - (s."embedding" <=> query.embedding))
          END
        ) AS section_vector_score
      FROM "sections" s
      JOIN "incidents" i ON i."id" = s."incident_id"
      CROSS JOIN query
      WHERE ${filterSql}
      GROUP BY s."incident_id"
    ),
    scored AS (
      SELECT
        incident_scores."id",
        incident_scores.incident_keyword_score,
        coalesce(section_scores.section_keyword_score, 0) AS section_keyword_score,
        incident_scores.incident_vector_score,
        coalesce(section_scores.section_vector_score, 0) AS section_vector_score,
        (
          incident_scores.incident_keyword_score * 2.0 +
          coalesce(section_scores.section_keyword_score, 0) * 2.5 +
          incident_scores.incident_vector_score * 0.7 +
          coalesce(section_scores.section_vector_score, 0) * 0.8
        ) AS score
      FROM incident_scores
      LEFT JOIN section_scores ON section_scores."id" = incident_scores."id"
    ),
    matched AS (
      SELECT *
      FROM scored
      WHERE incident_keyword_score > 0
        OR section_keyword_score > 0
        OR incident_vector_score > ${VECTOR_MATCH_THRESHOLD}
        OR section_vector_score > ${VECTOR_MATCH_THRESHOLD}
    )
    SELECT
      "id",
      score,
      incident_keyword_score AS "keywordScore",
      GREATEST(incident_vector_score, section_vector_score) AS "vectorScore",
      count(*) OVER() AS total
    FROM matched
    ORDER BY score DESC, "id" ASC
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `;

  try {
    const rows = await client.$queryRawUnsafe(sql, ...sqlParams);
    return {
      rows: rows.map((row) => ({
        id: row.id,
        score: Number(row.score),
        keywordScore: Number(row.keywordScore),
        vectorScore: Number(row.vectorScore),
      })),
      total: rows.length > 0 ? Number(rows[0].total) : 0,
    };
  } catch (error) {
    console.warn("[retrieval] pgvector search fallback:", error?.message ?? error);
    return null;
  }
}

async function similarWithPgvector(client, source, limit) {
  const sourceEmbedding = formatEmbeddingForSql(
    createEmbedding(buildIncidentEmbeddingText(source))
  );
  if (!sourceEmbedding) return [];

  try {
    const rows = await client.$queryRawUnsafe(
      `
        SELECT
          "id",
          GREATEST(0, 1 - ("summary_embedding" <=> $1::vector)) AS score
        FROM "incidents"
        WHERE "id" <> $2::uuid
          AND "summary_embedding" IS NOT NULL
        ORDER BY "summary_embedding" <=> $1::vector
        LIMIT $3
      `,
      sourceEmbedding,
      source.id,
      limit
    );

    return rows
      .map((row) => ({ id: row.id, score: Number(row.score) }))
      .filter((row) => row.score > 0.05);
  } catch (error) {
    console.warn("[retrieval] pgvector similar fallback:", error?.message ?? error);
    return [];
  }
}

async function searchLocally(client, params) {
  const where = buildPrismaFilters(params.filters);
  const queryEmbedding = createEmbedding(params.q);
  const incidents = await client.incident.findMany({
    where,
    include: { sections: { orderBy: { createdAt: "asc" } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  const scored = incidents
    .map((incident) => scoreIncident(params.q, queryEmbedding, incident))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || compareIncidentDates(a.incident, b.incident));

  const page = scored.slice(params.skip, params.skip + params.limit);
  return {
    data: page.map((item) =>
      toSearchResult(params.q, queryEmbedding, item.incident, {
        score: item.score,
        keywordScore: item.keywordScore,
        vectorScore: item.vectorScore,
      })
    ),
    total: scored.length,
  };
}

async function hydrateSearchRows(client, params, rows, total) {
  const queryEmbedding = createEmbedding(params.q);
  const incidents = await hydrateIncidents(client, rows.map((row) => row.id));

  return {
    data: rows
      .map((row) => {
        const incident = incidents.get(row.id);
        if (!incident) return null;
        return toSearchResult(params.q, queryEmbedding, incident, row);
      })
      .filter(Boolean),
    total,
  };
}

async function hydrateIncidents(client, ids) {
  if (ids.length === 0) return new Map();
  const incidents = await client.incident.findMany({
    where: { id: { in: ids } },
    include: { sections: { orderBy: { createdAt: "asc" } } },
  });
  return new Map(incidents.map((incident) => [incident.id, incident]));
}

function scoreIncident(query, queryEmbedding, incident) {
  const keywordScore = scoreKeyword(query, buildIncidentEmbeddingText(incident));
  const vectorScore = cosineSimilarity(
    queryEmbedding,
    createEmbedding(buildIncidentEmbeddingText(incident))
  );

  if (keywordScore <= 0 && vectorScore < VECTOR_MATCH_THRESHOLD) {
    return { incident, keywordScore, vectorScore, score: 0 };
  }

  return {
    incident,
    keywordScore,
    vectorScore,
    score: keywordScore * 2 + Math.max(0, vectorScore),
  };
}

function toSearchResult(query, queryEmbedding, incident, scores) {
  const matchedSections = findMatchedSections(query, queryEmbedding, incident.sections ?? []);
  const baseIncident = serializeIncident(incident);

  return {
    ...baseIncident,
    incident: baseIncident,
    score: roundScore(scores.score),
    keywordScore: roundScore(scores.keywordScore),
    vectorScore: roundScore(scores.vectorScore),
    matchedSections,
    sections: matchedSections,
  };
}

function toSimilarResult(source, incident, score) {
  return {
    ...serializeIncident(incident),
    score: roundScore(score),
    similarityReason: buildSimilarityReason(source, incident),
    matchedSections: mostSimilarSections(source, incident),
  };
}

function serializeIncident(incident) {
  return {
    id: incident.id,
    title: incident.title,
    date: incident.date,
    company: incident.company,
    severity: incident.severity,
    tags: incident.tags ?? [],
    products: incident.products ?? [],
    summaryText: incident.summaryText,
    createdAt: incident.createdAt,
  };
}

function findMatchedSections(query, queryEmbedding, sections) {
  if (sections.length === 0) return [];

  const scored = sections
    .map((section) => {
      const keywordScore = scoreKeyword(query, section.text);
      const vectorScore = cosineSimilarity(
        queryEmbedding,
        createEmbedding(buildSectionEmbeddingText(section))
      );
      return {
        ...section,
        score: keywordScore * 2 + Math.max(0, vectorScore),
        highlight: buildHighlight(section.text, query),
      };
    })
    .sort((a, b) => b.score - a.score);

  const matched = scored.filter((section) => section.score > 0).slice(0, MAX_MATCHED_SECTIONS);
  return (matched.length > 0 ? matched : scored.slice(0, 1)).map((section) => ({
    id: section.id,
    incidentId: section.incidentId,
    type: section.type,
    text: section.text,
    createdAt: section.createdAt,
    score: roundScore(section.score),
    highlight: section.highlight,
  }));
}

function mostSimilarSections(source, incident) {
  const sourceText = buildIncidentEmbeddingText(source);
  const sourceEmbedding = createEmbedding(sourceText);

  return (incident.sections ?? [])
    .map((section) => ({
      ...section,
      score: cosineSimilarity(sourceEmbedding, createEmbedding(buildSectionEmbeddingText(section))),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((section) => ({
      id: section.id,
      incidentId: section.incidentId,
      type: section.type,
      text: section.text,
      createdAt: section.createdAt,
      score: roundScore(section.score),
    }));
}

function buildSimilarityReason(source, incident) {
  const reasons = [];
  const sharedTags = sharedValues(source.tags, incident.tags);
  const sharedProducts = sharedValues(source.products, incident.products);

  if (sharedTags.length > 0) {
    reasons.push(`Shared tags: ${sharedTags.slice(0, 3).join(", ")}`);
  }
  if (sharedProducts.length > 0) {
    reasons.push(`Shared products: ${sharedProducts.slice(0, 3).join(", ")}`);
  }

  for (const type of ["impact", "rootcause", "fix"]) {
    const terms = sharedSectionTerms(source, incident, type);
    if (terms.length >= 2) {
      reasons.push(`${sectionLabel(type)} overlap: ${terms.slice(0, 4).join(", ")}`);
    }
  }

  if (
    source.company &&
    incident.company &&
    source.company.toLowerCase() === incident.company.toLowerCase()
  ) {
    reasons.push(`Same company: ${source.company}`);
  }

  return reasons[0] ?? "Similar summary and section language";
}

function sharedSectionTerms(source, incident, type) {
  const sourceText = (source.sections ?? [])
    .filter((section) => section.type === type)
    .map((section) => section.text)
    .join(" ");
  const incidentText = (incident.sections ?? [])
    .filter((section) => section.type === type)
    .map((section) => section.text)
    .join(" ");
  return sharedTokens(sourceText, incidentText);
}

function sectionLabel(type) {
  if (type === "rootcause") return "Root cause";
  if (type === "fix") return "Fix";
  return "Impact";
}

function sharedValues(left = [], right = []) {
  const rightSet = new Set(right.map((value) => String(value).toLowerCase()));
  return left.filter((value) => rightSet.has(String(value).toLowerCase()));
}

function sharedTokens(left, right) {
  const leftSet = new Set(tokenizeForRetrieval(left));
  const rightTokens = tokenizeForRetrieval(right);
  const seen = new Set();
  const shared = [];

  for (const token of rightTokens) {
    if (leftSet.has(token) && !seen.has(token)) {
      seen.add(token);
      shared.push(token);
    }
  }

  return shared;
}

function scoreKeyword(query, text) {
  const queryTokens = tokenizeForRetrieval(query);
  if (queryTokens.length === 0) return 0;

  const textTokens = tokenizeForRetrieval(text);
  if (textTokens.length === 0) return 0;

  let score = 0;
  for (const queryToken of queryTokens) {
    let matches = 0;
    for (const textToken of textTokens) {
      if (textToken === queryToken) matches += 1;
      else if (textToken.includes(queryToken) || queryToken.includes(textToken)) matches += 0.5;
    }
    score += Math.min(matches, 3);
  }

  return score / queryTokens.length;
}

function buildHighlight(text, query) {
  const tokens = tokenizeForRetrieval(query);
  const cleanText = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!cleanText) return "";

  const lower = cleanText.toLowerCase();
  const index = tokens
    .map((token) => lower.indexOf(token))
    .filter((value) => value >= 0)
    .sort((a, b) => a - b)[0];

  if (index === undefined) {
    return cleanText.length > 220 ? `${cleanText.slice(0, 217)}...` : cleanText;
  }

  const start = Math.max(0, index - 70);
  const end = Math.min(cleanText.length, index + 150);
  return `${start > 0 ? "..." : ""}${cleanText.slice(start, end)}${end < cleanText.length ? "..." : ""}`;
}

function buildPrismaFilters(filters) {
  const and = [];
  const date = {};

  if (filters.from) date.gte = filters.from;
  if (filters.to) date.lte = filters.to;
  if (Object.keys(date).length > 0) and.push({ date });
  if (filters.company) and.push({ company: { equals: filters.company, mode: "insensitive" } });
  if (filters.severity) and.push({ severity: { equals: filters.severity, mode: "insensitive" } });
  if (filters.tag) and.push({ tags: { has: filters.tag } });

  return and.length > 0 ? { AND: and } : {};
}

function buildSqlFilters(filters, params) {
  const clauses = ["TRUE"];

  if (filters.from) {
    params.push(filters.from);
    clauses.push(`i."date" >= $${params.length}::timestamp`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`i."date" <= $${params.length}::timestamp`);
  }
  if (filters.company) {
    params.push(filters.company);
    clauses.push(`lower(i."company") = lower($${params.length})`);
  }
  if (filters.severity) {
    params.push(filters.severity);
    clauses.push(`lower(i."severity") = lower($${params.length})`);
  }
  if (filters.tag) {
    params.push(filters.tag);
    clauses.push(`$${params.length} = ANY(i."tags")`);
  }

  return clauses.join(" AND ");
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function stringParam(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateParam(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function roundScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(4));
}

function compareIncidentDates(left, right) {
  const leftTime = left.date ? new Date(left.date).getTime() : new Date(left.createdAt).getTime();
  const rightTime = right.date ? new Date(right.date).getTime() : new Date(right.createdAt).getTime();
  return rightTime - leftTime;
}

// ─── Sprint 5: chunk-level hybrid retrieval ───────────────────────────────────
//
// Pipeline: metadata filters → (FTS ∥ vector backend) → RRF fusion → rerank →
// top-N evidence chunks with exact section citation anchors.
//
// Vector backend is selected by RETRIEVAL_BACKEND:
//   pgvector   — stable baseline (HNSW/IVFFlat index)
//   turboquant — EXPERIMENTAL compressed scan, verified against full vectors
//   hybrid     — both lists fused together
//
// Returns null when the chunk index is empty/unavailable so callers can fall
// back to the legacy section-level retrieval path.

function buildChunkSqlFilters(filters, params) {
  const clauses = ["TRUE"];
  if (filters?.company) {
    params.push(filters.company);
    clauses.push(`lower(c."company") = lower($${params.length})`);
  }
  if (filters?.severity) {
    params.push(filters.severity);
    clauses.push(`lower(c."severity") = lower($${params.length})`);
  }
  if (filters?.tag) {
    params.push(filters.tag);
    clauses.push(`$${params.length} = ANY(c."tags")`);
  }
  if (Array.isArray(filters?.incidentIds) && filters.incidentIds.length > 0) {
    params.push(filters.incidentIds);
    clauses.push(`c."incident_id" = ANY($${params.length}::uuid[])`);
  }
  return clauses.join(" AND ");
}

function buildChunkPrismaFilters(filters) {
  const where = {};
  if (filters?.company) where.company = { equals: filters.company, mode: "insensitive" };
  if (filters?.severity) where.severity = { equals: filters.severity, mode: "insensitive" };
  if (filters?.tag) where.tags = { has: filters.tag };
  if (Array.isArray(filters?.incidentIds) && filters.incidentIds.length > 0) {
    where.incidentId = { in: filters.incidentIds };
  }
  return where;
}

async function chunkKeywordCandidates(client, q, filters, limit) {
  const params = [q];
  const filterSql = buildChunkSqlFilters(filters, params);
  params.push(limit);
  const rows = await client.$queryRawUnsafe(
    `
      SELECT
        c."id",
        ts_rank_cd(to_tsvector('english', coalesce(c."text", '')), plainto_tsquery('english', $1)) AS score
      FROM "chunks" c
      WHERE ${filterSql}
        AND plainto_tsquery('english', $1) @@ to_tsvector('english', coalesce(c."text", ''))
      ORDER BY score DESC, c."id" ASC
      LIMIT $${params.length}
    `,
    ...params
  );
  return rows.map((row) => ({ id: row.id, score: Number(row.score) }));
}

async function chunkPgvectorCandidates(client, queryVectorSql, filters, limit) {
  const params = [queryVectorSql];
  const filterSql = buildChunkSqlFilters(filters, params);
  params.push(limit);
  // The VECTOR_MATCH_THRESHOLD floor mirrors the legacy incident search: ANN
  // always returns *nearest* neighbors, even meaningless ones — without the
  // floor, off-topic questions would surface junk candidates and defeat the
  // QA insufficient-evidence gate.
  const rows = await client.$queryRawUnsafe(
    `
      SELECT
        c."id",
        GREATEST(0, 1 - (c."embedding" <=> $1::vector)) AS score
      FROM "chunks" c
      WHERE ${filterSql}
        AND c."embedding" IS NOT NULL
        AND 1 - (c."embedding" <=> $1::vector) > ${VECTOR_MATCH_THRESHOLD}
      ORDER BY c."embedding" <=> $1::vector, c."id" ASC
      LIMIT $${params.length}
    `,
    ...params
  );
  return rows.map((row) => ({ id: row.id, score: Number(row.score) }));
}

/**
 * EXPERIMENTAL: approximate candidates from TurboQuant compressed codes,
 * then (when possible) verified/re-scored against the full pgvector column.
 */
async function chunkTurboquantCandidates(client, queryVector, filters, limit, config) {
  // Process-level TQ code cache. Loading ALL chunk codes from DB on every
  // query is O(corpus) bytes of I/O. Cache the deserialized entries for the
  // process lifetime; invalidateTqCache() resets it after any chunk write.
  // The cache stores filtering metadata (company/severity/tags/incidentId)
  // alongside the quantized vectors so in-process filtering avoids extra queries.
  if (!_tqCache.entries) {
    const allRows = await client.chunk.findMany({
      where: { tqCodes: { not: null } },
      select: {
        id: true, incidentId: true, company: true, severity: true, tags: true,
        tqCodes: true, tqResidual: true, tqMeta: true,
      },
    });
    if (allRows.length === 0) return { approx: [], verified: null };

    const refMeta = allRows[0].tqMeta;
    if (!refMeta?.paddedDims) return { approx: [], verified: null };

    const built = [];
    for (const row of allRows) {
      const meta = row.tqMeta;
      if (
        !meta ||
        meta.paddedDims !== refMeta.paddedDims ||
        meta.rotation !== refMeta.rotation ||
        meta.seed !== refMeta.seed
      ) continue;
      built.push({
        id: row.id,
        incidentId: row.incidentId,
        company: row.company,
        severity: row.severity,
        tags: row.tags ?? [],
        ...deserializeQuantized({ codes: row.tqCodes, residual: row.tqResidual, meta }),
      });
    }
    _tqCache.entries = built;
  }

  if (_tqCache.entries.length === 0) return { approx: [], verified: null };

  const firstMeta = _tqCache.entries[0].meta;
  if (!firstMeta) return { approx: [], verified: null };

  const prepared = prepareQuery(queryVector, {
    dims: firstMeta.dims,
    rotation: firstMeta.rotation,
    seed: firstMeta.seed,
  });
  if (!prepared) return { approx: [], verified: null };

  // Apply in-process filter so scoped queries (company/severity/tag/incidentIds)
  // only scan eligible chunks — avoids inflating recall with out-of-scope results.
  let entries = _tqCache.entries;
  if (filters) {
    const incidentIdSet = Array.isArray(filters.incidentIds) && filters.incidentIds.length > 0
      ? new Set(filters.incidentIds) : null;
    entries = entries.filter((e) => {
      if (incidentIdSet && !incidentIdSet.has(e.incidentId)) return false;
      if (filters.company && e.company?.toLowerCase() !== filters.company.toLowerCase()) return false;
      if (filters.severity && e.severity?.toLowerCase() !== filters.severity.toLowerCase()) return false;
      if (filters.tag && !e.tags.includes(filters.tag)) return false;
      return true;
    });
  }

  // Same minimum-similarity floor as the pgvector path (see comment there).
  const approx = scanCodes(prepared, entries, limit).filter(
    (item) => item.score > VECTOR_MATCH_THRESHOLD
  );

  // Verification pass: exact cosine over the full stored vectors for the
  // approximate top set (cheap — it's a bounded id list).
  let verified = null;
  try {
    const queryVectorSql = formatEmbeddingForSql(queryVector);
    const ids = approx.map((item) => item.id);
    if (queryVectorSql && ids.length > 0) {
      const verifiedRows = await client.$queryRawUnsafe(
        `
          SELECT c."id", GREATEST(0, 1 - (c."embedding" <=> $1::vector)) AS score
          FROM "chunks" c
          WHERE c."id" = ANY($2::uuid[]) AND c."embedding" IS NOT NULL
          ORDER BY c."embedding" <=> $1::vector
        `,
        queryVectorSql,
        ids
      );
      if (verifiedRows.length > 0) {
        verified = verifiedRows
          .map((row) => ({ id: row.id, score: Number(row.score) }))
          .filter((row) => row.score > VECTOR_MATCH_THRESHOLD);
      }
    }
  } catch {
    verified = null; // keep approximate scores when full vectors are unavailable
  }

  return { approx, verified };
}

/**
 * Hybrid chunk retrieval with score fusion, optional rerank, and debug traces.
 *
 * @param {import('@prisma/client').PrismaClient} client
 * @param {{
 *   q: string,
 *   filters?: { company?: string|null, severity?: string|null, tag?: string|null, incidentIds?: string[] },
 *   limit?: number,
 *   debug?: boolean,
 *   config?: ReturnType<typeof getRagConfig>,
 * }} params
 * @returns {Promise<{ evidence: Array<object>, traces: Array<object> | null, meta: object } | null>}
 *   null → chunk index empty/unavailable (caller should use the legacy path).
 */
export async function retrieveChunkEvidence(client, params) {
  const config = params.config ?? getRagConfig();
  const limit = params.limit ?? CHUNK_RETRIEVAL.DEFAULT_LIMIT;
  const filters = params.filters ?? {};
  const backend = config.retrieval.backend;

  try {
    const chunkCount = await client.chunk.count();
    if (chunkCount === 0) return null;

    const queryVector = await embedText(params.q, { isQuery: true, config });
    const queryVectorSql = formatEmbeddingForSql(queryVector);

    const lists = [];
    const keyword = await chunkKeywordCandidates(
      client,
      params.q,
      filters,
      CHUNK_RETRIEVAL.CANDIDATES_PER_BACKEND
    );
    if (keyword.length > 0) {
      lists.push({ name: "keyword", weight: CHUNK_RETRIEVAL.KEYWORD_WEIGHT, items: keyword });
    }

    let turboquantUsed = false;
    let turboquantVerified = false;

    if ((backend === "pgvector" || backend === "hybrid") && queryVectorSql) {
      const vector = await chunkPgvectorCandidates(
        client,
        queryVectorSql,
        filters,
        CHUNK_RETRIEVAL.CANDIDATES_PER_BACKEND
      );
      if (vector.length > 0) {
        lists.push({ name: "vector", weight: CHUNK_RETRIEVAL.VECTOR_WEIGHT, items: vector });
      }
    }

    if ((backend === "turboquant" || backend === "hybrid") && queryVector) {
      const { approx, verified } = await chunkTurboquantCandidates(
        client,
        queryVector,
        filters,
        CHUNK_RETRIEVAL.CANDIDATES_PER_BACKEND,
        config
      );
      const items = verified ?? approx;
      turboquantUsed = items.length > 0;
      turboquantVerified = verified !== null;
      if (items.length > 0) {
        lists.push({
          name: "turboquant",
          weight: CHUNK_RETRIEVAL.TURBOQUANT_WEIGHT,
          items,
        });
      }
    }

    if (lists.length === 0) return { evidence: [], traces: params.debug ? [] : null, meta: chunkMeta(config, backend, { turboquantUsed, turboquantVerified }) };

    const fused = rrfFuse(lists);
    const pool = fused.slice(0, CHUNK_RETRIEVAL.RERANK_POOL);

    const chunkRows = await client.chunk.findMany({
      where: { id: { in: pool.map((item) => item.id) } },
      include: {
        incident: {
          select: { id: true, title: true, company: true, date: true, severity: true, tags: true },
        },
      },
    });
    const rowsById = new Map(chunkRows.map((row) => [row.id, row]));

    const rerankInput = pool
      .filter((item) => rowsById.has(item.id))
      .map((item) => ({ id: item.id, text: rowsById.get(item.id).text }));
    const reranked = await rerankCandidates(params.q, rerankInput, { config });
    const rerankScoreById = new Map(reranked.results.map((r) => [r.id, r.rerankScore]));

    // Final order: rerank order when a reranker ran, fused order otherwise.
    const finalOrder =
      reranked.provider === "none"
        ? pool.map((item) => item.id)
        : reranked.results.map((r) => r.id);

    const fusedById = new Map(pool.map((item) => [item.id, item]));
    const evidence = [];
    const traces = [];

    for (const id of finalOrder) {
      const row = rowsById.get(id);
      const fusedItem = fusedById.get(id);
      if (!row || !fusedItem) continue;

      const vectorScore =
        fusedItem.sources.vector?.score ?? fusedItem.sources.turboquant?.score ?? null;
      const rerankScore = rerankScoreById.get(id) ?? null;
      const retrievalScore = Math.max(
        vectorScore ?? 0,
        rerankScore ?? 0,
        fusedItem.sources.keyword ? 0.3 : 0
      );

      evidence.push({
        incidentId: row.incidentId,
        sectionId: row.sectionId,
        sectionType: row.sectionType,
        text: row.text,
        title: row.incident?.title ?? null,
        company: row.incident?.company ?? row.company ?? null,
        date: row.incident?.date ?? null,
        severity: row.incident?.severity ?? row.severity ?? null,
        tags: row.incident?.tags ?? row.tags ?? [],
        retrievalScore: Number(retrievalScore.toFixed(4)),
        chunkId: row.id,
        chunkType: row.chunkType,
      });

      if (params.debug) {
        traces.push(buildRetrievalTrace(fusedItem, { backend, rerankScore }));
      }

      if (evidence.length >= limit) break;
    }

    return {
      evidence,
      traces: params.debug ? traces : null,
      meta: chunkMeta(config, backend, {
        turboquantUsed,
        turboquantVerified,
        reranker: reranked.provider,
        candidates: fused.length,
      }),
    };
  } catch (error) {
    // Missing table (P2021) before migration, or any other failure → legacy path.
    console.warn("[retrieval] chunk retrieval unavailable, using legacy path:", error?.message);
    return null;
  }
}

function chunkMeta(config, backend, extra = {}) {
  return {
    retrievalBackend: backend,
    embedding: describeEmbeddingProvider(config),
    ...extra,
  };
}
