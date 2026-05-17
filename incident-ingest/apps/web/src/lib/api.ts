// ─── Domain types ────────────────────────────────────────────────────────────

export type SectionType = "impact" | "timeline" | "rootcause" | "fix";

export interface Section {
  id: string;
  incidentId?: string;
  type: SectionType;
  text: string;
  createdAt?: string;
  score?: number | null;
  highlight?: string | null;
}

export interface Incident {
  id: string;
  title: string;
  date: string | null;
  company: string | null;
  severity: string | null;
  tags: string[];
  products: string[];
  summaryText: string | null;
  createdAt?: string;
}

export interface IncidentDetail extends Incident {
  sections: Section[];
}

export interface ManualIngestPayload {
  title: string;
  rawText: string;
  company?: string;
  date?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ── Sprint 2: Search contract (mirrors API_SPEC.md) ──────────────────────────

/** A single evidence snippet attached to a search result. */
export interface Evidence {
  id: string;
  type: SectionType;
  text: string;
  highlight?: string | null;
  score?: number | null;
}

/** A single search result as returned by GET /search. */
export interface SearchResult {
  incident: Incident;
  score: number;
  keywordScore?: number;
  vectorScore?: number;
  evidence: Evidence[];
}

export interface SearchParams {
  q: string;
  filterCompany?: string;
  filterSeverity?: string;
  filterTag?: string;
  page?: number;
  limit?: number;
}

/** Full response from GET /search. */
export interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  limit: number;
  q: string;
  filters: {
    company: string | null;
    severity: string | null;
    tag: string | null;
    from: string | null;
    to: string | null;
  };
}

// ── Sprint 2: Similar incidents contract ─────────────────────────────────────

/** A single similar incident as returned by GET /incidents/:id/similar. */
export interface SimilarIncidentResult {
  incident: Incident;
  score: number;
  reason: string;
  matchedSections: Section[];
}

/** Full response from GET /incidents/:id/similar. */
export interface SimilarResponse {
  similar: SimilarIncidentResult[];
  total: number;
  limit: number;
}

// ── Sprint 3: Graph contract (mirrors API_SPEC.md) ───────────────────────────

export type GraphNodeType = "service" | "symptom" | "root_cause" | "fix" | string;

/** A graph entity node. */
export interface GraphNode {
  id: string;
  name: string;
  type: GraphNodeType;
}

/** A directed, evidence-backed relationship between two graph nodes. */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  evidence_section_id: string;
}

/** A recurring node cluster returned by GET /graph/patterns. */
export interface GraphPattern {
  incidentCount: number;
  nodes: GraphNode[];
}

/** Full response from GET /graph/patterns. */
export interface GraphPatternsResponse {
  patterns: GraphPattern[];
  page: number;
  hasMore: boolean;
}

/** Full response from GET /graph/neighbors. */
export interface GraphNeighborsResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphPatternsParams {
  service?: string;
  symptom?: string;
  page?: number;
}

// ── Sprint 4: Q&A and Eval contract (mirrors API_SPEC.md) ────────────────────

export interface QaPayload {
  question: string;
  filters?: {
    company?: string;
    tags?: string[];
    incidentIds?: string[];
  };
  options?: {
    maxEvidenceSections?: number;
    includeGraphContext?: boolean;
    mode?: "answer" | "eval";
  };
}

export interface QaCitation {
  label: string;
  incidentId: string;
  sectionId: string;
  sectionType: string;
  title: string;
  company: string | null;
  date: string | null;
  excerpt: string;
  anchor: string;
  retrievalScore: number;
}

export interface QaResponse {
  status: "answered" | "refused";
  answer: string | null;
  citations: QaCitation[];
  refusal?: {
    reasonCode: "insufficient_evidence" | "unsupported_scope" | "unsafe_prompt" | "citation_validation_failed";
    message: string;
  };
  evidenceCount: number;
  promptVersion: string;
  model: {
    provider: string;
    name: string;
    version: string | null;
  };
  auditId: string;
}

export interface EvalLatestResponse {
  runId: string;
  status: "passed" | "failed" | "error";
  mode: "fixture" | "live";
  querySetVersion: string;
  createdAt: string;
  finishedAt: string;
  gitSha: string | null;
  retrievalConfig: Record<string, any>;
  graphConfig: Record<string, any>;
  promptVersion: string;
  models: Array<{ provider: string; model: string; version: string | null }>;
  metrics: Record<string, number | null>;
  thresholds: Record<string, number>;
  failures: any[];
  artifactPath: string;
}

// ── Job tracking ─────────────────────────────────────────────────────────────

export interface JobStatus {
  id: string;
  status: "waiting" | "active" | "completed" | "failed";
  progress?: number;
  result?: any;
  error?: string;
  documentId?: string;
  parseStatus?: string;
}

export interface UploadResponse {
  jobId: string;
  documentId: string;
  bullmqJobId?: string;
}

// ─── HTTP layer ───────────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    const text = await res.text();
    if (text) {
      try {
        const data = JSON.parse(text);
        if (data && typeof data.error === "string") {
          message = data.error;
        } else {
          message = text;
        }
      } catch {
        message = text;
      }
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN as string | undefined;

export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const headers: HeadersInit = {};
  if (ADMIN_TOKEN) {
    headers.Authorization = `Bearer ${ADMIN_TOKEN}`;
  }

  const res = await fetch(`${API_URL}/ingest/upload`, {
    method: "POST",
    body: formData,
    headers,
  });

  if (!res.ok) {
    let message = `Upload failed: ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data.error === "string") {
        message = data.error;
      }
    } catch {
      // Ignore JSON parse failure.
    }
    throw new Error(message);
  }

  return res.json() as Promise<UploadResponse>;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * GET /incidents — list all incidents (summary only).
 * The API returns a paginated envelope { data, total, page, limit };
 * we unwrap .data here so all consumers get a plain Incident[].
 */
export function getIncidents(): Promise<Incident[]> {
  return request<PaginatedResponse<Incident>>("/incidents").then((res) => {
    if (Array.isArray(res)) return res as unknown as Incident[];
    if (res && Array.isArray(res.data)) return res.data;
    return [];
  });
}

/** GET /incidents/:id — full detail with sections */
export function getIncident(id: string): Promise<IncidentDetail> {
  return request<IncidentDetail>(`/incidents/${id}`);
}

/** POST /ingest/manual — create incident from raw text */
export function createManualIncident(
  payload: ManualIngestPayload
): Promise<IncidentDetail> {
  return request<IncidentDetail>("/ingest/manual", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** GET /jobs/:id — poll job status */
export function getJobStatus(id: string): Promise<JobStatus> {
  return request<JobStatus>(`/jobs/${id}`);
}

/**
 * GET /search?q=…&company=…&severity=…&tag=…&page=…&limit=…
 * Hybrid FTS + vector search. Returns scored results with evidence snippets.
 */
export function searchIncidents(params: SearchParams): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.filterCompany) qs.set("company", params.filterCompany);
  if (params.filterSeverity) qs.set("severity", params.filterSeverity);
  if (params.filterTag) qs.set("tag", params.filterTag);
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  return request<SearchResponse>(`/search?${qs.toString()}`);
}

/**
 * GET /incidents/:id/similar
 * Returns top-N similar incidents with reasons and evidence.
 */
export function getSimilarIncidents(
  id: string
): Promise<SimilarIncidentResult[]> {
  return request<SimilarResponse>(`/incidents/${id}/similar`).then(
    (res) => res.similar ?? []
  );
}

/** GET /health — API health check */
export function getHealth(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/health");
}

/**
 * GET /graph/patterns?service=…&symptom=…&page=…
 * Returns recurring node clusters filtered by service or symptom name.
 */
export function getGraphPatterns(
  params: GraphPatternsParams
): Promise<GraphPatternsResponse> {
  const qs = new URLSearchParams();
  if (params.service) qs.set("service", params.service);
  if (params.symptom) qs.set("symptom", params.symptom);
  if (params.page) qs.set("page", String(params.page));
  return request<GraphPatternsResponse>(`/graph/patterns?${qs.toString()}`);
}

/**
 * GET /graph/neighbors?node_id=…&depth=…
 * BFS traversal up to depth hops (max 2). Returns nodes and edges.
 */
export function getGraphNeighbors(
  nodeId: string,
  depth: 1 | 2 = 1
): Promise<GraphNeighborsResponse> {
  return request<GraphNeighborsResponse>(
    `/graph/neighbors?node_id=${encodeURIComponent(nodeId)}&depth=${depth}`
  );
}

/**
 * POST /qa
 * Ask a question against the incident corpus.
 */
export function postQa(payload: QaPayload): Promise<QaResponse> {
  const headers: HeadersInit = {};
  if (ADMIN_TOKEN) {
    headers.Authorization = `Bearer ${ADMIN_TOKEN}`;
  }

  return request<QaResponse>("/qa", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

/**
 * GET /eval/latest
 * Get the latest evaluation run report.
 */
export function getEvalLatest(): Promise<EvalLatestResponse> {
  const headers: HeadersInit = {};
  if (ADMIN_TOKEN) {
    headers.Authorization = `Bearer ${ADMIN_TOKEN}`;
  }
  return request<EvalLatestResponse>("/eval/latest", {
    headers,
  });
}
