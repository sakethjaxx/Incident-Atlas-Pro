import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describeEmbeddingProvider, getRagConfig } from "@pkg/nlp";
import { searchIncidents } from "@pkg/db";

const VALID_QUERY_TYPES = new Set(["search", "graph", "qa", "mixed"]);
const VALID_MODES = new Set(["fixture", "live"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Open-source stack: the embedding model is env-driven (EMBEDDING_PROVIDER /
// EMBEDDING_MODEL), defaulting to the deterministic local embedding.
export const DEFAULT_RETRIEVAL_CONFIG = {
  searchLimit: 10,
  evidenceSectionLimit: 8,
  get embeddingModel() {
    return describeEmbeddingProvider(getRagConfig()).model;
  },
  get retrievalBackend() {
    return getRagConfig().retrieval.backend;
  },
};

export const DEFAULT_GRAPH_CONFIG = {
  enabled: false,
  maxDepth: 1,
};

export const DEFAULT_THRESHOLDS = {
  criticalRecallAt5: 1.0,
  maxRecallAt5Drop: null,
  maxMrrDrop: null,
  requireEvidenceEdgeCoverage: null,
  requireQaCitationPrecision: null,
  requireRefusalAccuracy: null,
};

const THRESHOLD_KEYS = new Set(Object.keys(DEFAULT_THRESHOLDS));

export class EvalValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvalValidationError";
    this.status = 400;
  }
}

function badRequest(message) {
  throw new EvalValidationError(message);
}

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export async function upsertEvalQueries(client, body) {
  const payload = validateQueryUpsertPayload(body);
  const ids = payload.queries.map((query) => query.id);
  const existingRows = await client.qaQuery.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existingRows.map((row) => row.id));

  if (payload.replace) {
    await client.qaQuery.deleteMany({
      where: { querySetVersion: payload.querySetVersion },
    });
  }

  const stored = [];
  for (const query of payload.queries) {
    const row = await client.qaQuery.upsert({
      where: { id: query.id },
      create: {
        id: query.id,
        question: query.question,
        expectedIncidentIds: query.expectedIncidentIds,
        expectedSectionIds: query.expectedSectionIds,
        expectedGraphNodeIds: query.expectedGraphNodeIds,
        queryType: query.queryType,
        critical: query.critical,
        tags: query.tags,
        querySetVersion: payload.querySetVersion,
        metadataJson: query.metadata,
      },
      update: {
        question: query.question,
        expectedIncidentIds: query.expectedIncidentIds,
        expectedSectionIds: query.expectedSectionIds,
        expectedGraphNodeIds: query.expectedGraphNodeIds,
        queryType: query.queryType,
        critical: query.critical,
        tags: query.tags,
        querySetVersion: payload.querySetVersion,
        metadataJson: query.metadata,
      },
    });
    stored.push(row);
  }

  return {
    querySetVersion: payload.querySetVersion,
    imported: payload.queries.filter((query) => !existingIds.has(query.id)).length,
    updated: payload.queries.filter((query) => existingIds.has(query.id)).length,
    skipped: 0,
    queries: stored.map(serializeEvalQuery),
  };
}

export async function runEval(client, body) {
  const config = validateRunPayload(body);
  const versionCount = await client.qaQuery.count({
    where: { querySetVersion: config.querySetVersion },
  });

  if (versionCount === 0) {
    badRequest("Unknown querySetVersion");
  }

  const queries = await client.qaQuery.findMany({
    where: {
      querySetVersion: config.querySetVersion,
      ...(config.queryIds ? { id: { in: config.queryIds } } : {}),
    },
    orderBy: { id: "asc" },
  });

  if (queries.length === 0) {
    badRequest("No runnable eval queries");
  }

  const baseline = config.baselineRunId
    ? await client.evalRun.findUnique({ where: { id: config.baselineRunId } })
    : null;

  if (config.baselineRunId && !baseline) {
    badRequest("baselineRunId was not found");
  }

  const runId = crypto.randomUUID();
  const startedAt = new Date();
  const retrievalConfig = { ...DEFAULT_RETRIEVAL_CONFIG };
  const graphConfig = {
    ...DEFAULT_GRAPH_CONFIG,
    enabled: config.includeGraph,
  };

  const perQuery = [];
  for (const query of queries) {
    perQuery.push(
      await evaluateQuery(client, query, {
        retrievalConfig,
        includeGraph: config.includeGraph,
      })
    );
  }

  const metrics = aggregateMetrics(perQuery, config.includeGraph);
  const failures = buildFailures({
    perQuery,
    metrics,
    thresholds: config.thresholds,
    baselineMetrics: baseline?.metricsJson ?? null,
  });
  const status = failures.length === 0 ? "passed" : "failed";
  const finishedAt = new Date();
  const gitSha = getGitSha();
  const artifactPath = `artifacts/eval/${runId}/eval_report.json`;
  const models = [];

  const report = {
    runId,
    status,
    mode: config.mode,
    querySetVersion: config.querySetVersion,
    createdAt: startedAt.toISOString(),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    gitSha,
    retrievalConfig,
    graphConfig,
    promptVersion: null,
    models,
    thresholds: config.thresholds,
    metrics,
    perQuery,
    failures,
    artifactPath,
  };

  await writeEvalArtifact(report, artifactPath);

  const row = await client.evalRun.create({
    data: {
      id: runId,
      status,
      mode: config.mode,
      querySetVersion: config.querySetVersion,
      gitSha,
      startedAt,
      finishedAt,
      retrievalConfigJson: retrievalConfig,
      graphConfigJson: graphConfig,
      promptVersion: null,
      provider: null,
      model: null,
      modelVersion: null,
      modelConfigJson: null,
      thresholdsJson: config.thresholds,
      metricsJson: metrics,
      failuresJson: failures,
      artifactPath,
    },
  });

  return toEvalRunResponse(row);
}

export async function getLatestEvalReport(client) {
  const row = await client.evalRun.findFirst({
    where: { finishedAt: { not: null } },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
  });

  return row ? toEvalRunResponse(row) : null;
}

export function calculateRecallAtK(expectedIds, retrievedIds, k) {
  const expected = unique(expectedIds);
  if (expected.length === 0) return null;
  const topK = new Set(retrievedIds.slice(0, k));
  return round(expected.filter((id) => topK.has(id)).length / expected.length);
}

export function calculateMrr(expectedIds, retrievedIds) {
  const expected = new Set(unique(expectedIds));
  if (expected.size === 0) return null;
  const index = retrievedIds.findIndex((id) => expected.has(id));
  return index === -1 ? 0 : round(1 / (index + 1));
}

export function calculateNdcgAtK(expectedIds, retrievedIds, k) {
  const expected = new Set(unique(expectedIds));
  if (expected.size === 0) return null;

  let dcg = 0;
  retrievedIds.slice(0, k).forEach((id, index) => {
    if (expected.has(id)) {
      dcg += 1 / Math.log2(index + 2);
    }
  });

  let ideal = 0;
  for (let index = 0; index < Math.min(expected.size, k); index += 1) {
    ideal += 1 / Math.log2(index + 2);
  }

  return ideal === 0 ? null : round(dcg / ideal);
}

function validateQueryUpsertPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    badRequest("Request body must be an object");
  }

  const querySetVersion = stringField(body.querySetVersion, "querySetVersion");
  if (!Array.isArray(body.queries) || body.queries.length === 0) {
    badRequest("queries must be a non-empty array");
  }

  const seen = new Set();
  const queries = body.queries.map((query, index) => {
    if (!query || typeof query !== "object" || Array.isArray(query)) {
      badRequest(`queries[${index}] must be an object`);
    }

    const id = stringField(query.id, `queries[${index}].id`);
    if (!/^[a-zA-Z0-9._:-]+$/.test(id)) {
      badRequest(`queries[${index}].id contains unsupported characters`);
    }
    if (seen.has(id)) {
      badRequest(`Duplicate query id: ${id}`);
    }
    seen.add(id);

    const question = stringField(query.question, `queries[${index}].question`);
    const queryType = stringField(query.queryType ?? "search", `queries[${index}].queryType`);
    if (!VALID_QUERY_TYPES.has(queryType)) {
      badRequest(`queries[${index}].queryType is invalid`);
    }

    const tags = arrayOfStrings(query.tags ?? [], `queries[${index}].tags`);
    const metadata = objectOrNull(query.metadata ?? null, `queries[${index}].metadata`);

    return {
      id,
      question,
      queryType,
      critical: Boolean(query.critical),
      tags,
      metadata,
      expectedIncidentIds: arrayOfUuids(
        query.expectedIncidentIds ?? [],
        `queries[${index}].expectedIncidentIds`
      ),
      expectedSectionIds: arrayOfUuids(
        query.expectedSectionIds ?? [],
        `queries[${index}].expectedSectionIds`
      ),
      expectedGraphNodeIds: arrayOfUuids(
        query.expectedGraphNodeIds ?? [],
        `queries[${index}].expectedGraphNodeIds`
      ),
    };
  });

  return {
    querySetVersion,
    replace: Boolean(body.replace),
    queries,
  };
}

function validateRunPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    badRequest("Request body must be an object");
  }

  const querySetVersion = stringField(body.querySetVersion, "querySetVersion");
  const mode = body.mode ?? "fixture";
  if (!VALID_MODES.has(mode)) {
    badRequest("mode must be fixture or live");
  }
  if (body.includeQa === true) {
    badRequest("includeQa is not implemented for W4-001");
  }

  const queryIds =
    body.queryIds === undefined
      ? null
      : arrayOfStrings(body.queryIds, "queryIds").map((id) => id.trim());

  const baselineRunId = body.baselineRunId ?? null;
  if (baselineRunId !== null && !isUuid(baselineRunId)) {
    badRequest("baselineRunId must be a valid UUID or null");
  }

  return {
    querySetVersion,
    mode,
    queryIds,
    includeGraph: Boolean(body.includeGraph),
    baselineRunId,
    thresholds: normalizeThresholds(body.thresholds ?? {}),
  };
}

async function evaluateQuery(client, query, { retrievalConfig, includeGraph }) {
  const result = await searchIncidents(client, {
    q: query.question,
    page: 1,
    limit: retrievalConfig.searchLimit,
    skip: 0,
    filters: {
      company: null,
      severity: null,
      tag: null,
      from: null,
      to: null,
    },
  });

  const results = result.data ?? [];
  const retrievedIncidentIds = unique(
    results.map((item) => item.incident?.id ?? item.id).filter(Boolean)
  );
  const retrievedEvidenceSectionIds = unique(
    results
      .flatMap((item) => item.matchedSections ?? item.sections ?? [])
      .map((section) => section.id)
      .filter(Boolean)
  ).slice(0, retrievalConfig.evidenceSectionLimit);

  const expectedIncidentIds = query.expectedIncidentIds ?? [];
  const expectedSectionIds = query.expectedSectionIds ?? [];
  const expectedGraphNodeIds = query.expectedGraphNodeIds ?? [];
  const recallAt5 = calculateRecallAtK(expectedIncidentIds, retrievedIncidentIds, 5);
  const recallAt10 = calculateRecallAtK(expectedIncidentIds, retrievedIncidentIds, 10);
  const mrr = calculateMrr(expectedIncidentIds, retrievedIncidentIds);
  const ndcgAt10 = calculateNdcgAtK(expectedIncidentIds, retrievedIncidentIds, 10);
  const expectedSectionRecallAt5 =
    expectedSectionIds.length === 0
      ? null
      : round(
          expectedSectionIds.filter((id) => retrievedEvidenceSectionIds.includes(id)).length /
            expectedSectionIds.length
        );

  const graph = includeGraph
    ? await evaluateGraph(client, {
        expectedGraphNodeIds,
        retrievedIncidentIds: retrievedIncidentIds.slice(0, 5),
      })
    : {
        retrievedGraphNodeIds: [],
        graphEvidenceRecallAt5: null,
        evidenceEdgeCoverage: null,
        edgeCount: 0,
      };

  return {
    id: query.id,
    queryType: query.queryType,
    critical: query.critical,
    tags: query.tags ?? [],
    expectedIncidentIds,
    expectedSectionIds,
    expectedGraphNodeIds,
    retrievedIncidentIds,
    retrievedEvidenceSectionIds,
    retrievedGraphNodeIds: graph.retrievedGraphNodeIds,
    resultCount: retrievedIncidentIds.length,
    edgeCount: graph.edgeCount,
    metrics: {
      recallAt5,
      recallAt10,
      mrr,
      ndcgAt10,
      expectedSectionRecallAt5,
      graphEvidenceRecallAt5: graph.graphEvidenceRecallAt5,
      evidenceEdgeCoverage: graph.evidenceEdgeCoverage,
    },
  };
}

async function evaluateGraph(client, { expectedGraphNodeIds, retrievedIncidentIds }) {
  if (retrievedIncidentIds.length === 0) {
    return {
      retrievedGraphNodeIds: [],
      graphEvidenceRecallAt5: expectedGraphNodeIds.length > 0 ? 0 : null,
      evidenceEdgeCoverage: expectedGraphNodeIds.length > 0 ? 0 : null,
      edgeCount: 0,
    };
  }

  const edges = await client.graphEdge.findMany({
    where: { incidentId: { in: retrievedIncidentIds } },
    select: {
      fromNodeId: true,
      toNodeId: true,
      evidenceSectionId: true,
    },
  });
  const retrievedGraphNodeIds = unique(
    edges.flatMap((edge) => [edge.fromNodeId, edge.toNodeId]).filter(Boolean)
  );
  const graphEvidenceRecallAt5 =
    expectedGraphNodeIds.length === 0
      ? null
      : round(
          expectedGraphNodeIds.filter((id) => retrievedGraphNodeIds.includes(id)).length /
            expectedGraphNodeIds.length
        );
  const evidenceEdgeCoverage =
    edges.length === 0
      ? expectedGraphNodeIds.length > 0
        ? 0
        : null
      : round(edges.filter((edge) => edge.evidenceSectionId).length / edges.length);

  return {
    retrievedGraphNodeIds,
    graphEvidenceRecallAt5,
    evidenceEdgeCoverage,
    edgeCount: edges.length,
  };
}

function aggregateMetrics(perQuery, includeGraph) {
  return {
    recallAt5: average(perQuery.map((query) => query.metrics.recallAt5)),
    recallAt10: average(perQuery.map((query) => query.metrics.recallAt10)),
    mrr: average(perQuery.map((query) => query.metrics.mrr)),
    ndcgAt10: average(perQuery.map((query) => query.metrics.ndcgAt10)),
    zeroResultRate: round(
      perQuery.filter((query) => query.resultCount === 0).length / Math.max(1, perQuery.length)
    ),
    criticalMissCount: perQuery.filter(
      (query) => query.critical && query.metrics.recallAt5 !== null && query.metrics.recallAt5 < 1
    ).length,
    graphEvidenceRecallAt5: includeGraph
      ? average(perQuery.map((query) => query.metrics.graphEvidenceRecallAt5))
      : null,
    evidenceEdgeCoverage: includeGraph
      ? average(perQuery.map((query) => query.metrics.evidenceEdgeCoverage))
      : null,
    qaCitationPrecision: null,
    qaGroundedAnswerPassRate: null,
    qaRefusalAccuracy: null,
  };
}

function buildFailures({ perQuery, metrics, thresholds, baselineMetrics }) {
  const failures = [];

  for (const query of perQuery) {
    if (
      query.critical &&
      query.metrics.recallAt5 !== null &&
      query.metrics.recallAt5 < thresholds.criticalRecallAt5
    ) {
      failures.push({
        type: "critical_recall_at_5",
        queryId: query.id,
        expected: thresholds.criticalRecallAt5,
        actual: query.metrics.recallAt5,
        missingIncidentIds: query.expectedIncidentIds.filter(
          (id) => !query.retrievedIncidentIds.slice(0, 5).includes(id)
        ),
      });
    }
  }

  if (
    thresholds.requireEvidenceEdgeCoverage !== null &&
    metrics.evidenceEdgeCoverage !== null &&
    metrics.evidenceEdgeCoverage < thresholds.requireEvidenceEdgeCoverage
  ) {
    failures.push({
      type: "evidence_edge_coverage",
      expected: thresholds.requireEvidenceEdgeCoverage,
      actual: metrics.evidenceEdgeCoverage,
    });
  }

  if (baselineMetrics) {
    maybeAddDropFailure(failures, {
      metric: "recallAt5",
      current: metrics.recallAt5,
      baseline: baselineMetrics.recallAt5,
      maxDrop: thresholds.maxRecallAt5Drop,
    });
    maybeAddDropFailure(failures, {
      metric: "mrr",
      current: metrics.mrr,
      baseline: baselineMetrics.mrr,
      maxDrop: thresholds.maxMrrDrop,
    });
  }

  return failures;
}

function maybeAddDropFailure(failures, { metric, current, baseline, maxDrop }) {
  if (maxDrop === null || current === null || baseline === null) return;
  const drop = round(Number(baseline) - Number(current));
  if (drop > maxDrop) {
    failures.push({
      type: "metric_drop",
      metric,
      baseline: Number(baseline),
      actual: Number(current),
      maxDrop,
      drop,
    });
  }
}

function normalizeThresholds(thresholds) {
  if (!thresholds || typeof thresholds !== "object" || Array.isArray(thresholds)) {
    badRequest("thresholds must be an object");
  }

  const normalized = { ...DEFAULT_THRESHOLDS };
  for (const [key, value] of Object.entries(thresholds)) {
    if (!THRESHOLD_KEYS.has(key)) {
      badRequest(`Unknown threshold: ${key}`);
    }
    if (value === null) {
      normalized[key] = null;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      badRequest(`${key} must be a number between 0 and 1`);
    }
    normalized[key] = value;
  }

  return normalized;
}

function toEvalRunResponse(row) {
  const models =
    row.provider || row.model
      ? [
          {
            provider: row.provider,
            model: row.model,
            version: row.modelVersion,
          },
        ]
      : [];

  return {
    runId: row.id,
    status: row.status,
    mode: row.mode,
    querySetVersion: row.querySetVersion,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    gitSha: row.gitSha,
    retrievalConfig: row.retrievalConfigJson,
    graphConfig: row.graphConfigJson,
    promptVersion: row.promptVersion,
    models,
    metrics: row.metricsJson,
    thresholds: row.thresholdsJson,
    failures: row.failuresJson,
    artifactPath: row.artifactPath,
  };
}

function serializeEvalQuery(row) {
  return {
    id: row.id,
    question: row.question,
    queryType: row.queryType,
    critical: row.critical,
    tags: row.tags ?? [],
  };
}

async function writeEvalArtifact(report, artifactPath) {
  const root = process.env.EVAL_ARTIFACT_ROOT
    ? path.resolve(process.env.EVAL_ARTIFACT_ROOT)
    : process.cwd();
  const target = path.resolve(root, artifactPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
}

function getGitSha() {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function stringField(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    badRequest(`${field} is required`);
  }
  return value.trim();
}

function arrayOfStrings(value, field) {
  if (!Array.isArray(value)) {
    badRequest(`${field} must be an array`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      badRequest(`${field}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
}

function arrayOfUuids(value, field) {
  return arrayOfStrings(value, field).map((item, index) => {
    if (!isUuid(item)) {
      badRequest(`${field}[${index}] must be a valid UUID`);
    }
    return item;
  });
}

function objectOrNull(value, field) {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    badRequest(`${field} must be an object`);
  }
  return value;
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function average(values) {
  const scored = values.filter((value) => value !== null && Number.isFinite(value));
  if (scored.length === 0) return null;
  return round(scored.reduce((sum, value) => sum + value, 0) / scored.length);
}

function round(value) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(4));
}
