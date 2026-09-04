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

// ── Access scope (shared by Upload + Search + Q&A) ───────────────────────────

/** Which corpus a search / Q&A request runs against. */
export type ScopeSource = "uploaded_documents" | "public_web";

/** Scope selector the client sends on search / Q&A requests. */
export interface SearchScope {
  source: ScopeSource;
  companies?: string[];
}

/** Scope the server echoes back on a response. */
export interface AccessScope {
  source: ScopeSource;
  companies?: string[];
  mode?: string;
}

/** Per-result provenance: why the caller is allowed to see this result. */
export interface SourceAccess {
  source: ScopeSource;
  label: string;
  accessReason: string;
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
  sourceAccess?: SourceAccess;
}

export interface SearchParams {
  q: string;
  scope?: SearchScope;
  filterCompany?: string;
  filterSeverity?: string;
  filterTag?: string;
  filterFrom?: string;
  filterTo?: string;
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
  scope?: AccessScope;
  publicWeb?: { status: string; message: string } | null;
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
  scope?: SearchScope;
  filters?: {
    company?: string;
    tags?: string[];
    incidentIds?: string[];
    from?: string;
    to?: string;
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
  sourceAccess?: SourceAccess;
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
  confidence?: number;
  confidenceTier?: "high" | "medium" | "low";
  scope?: AccessScope;
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
  smallSampleWarning?: boolean;
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
  pollUrl?: string;
  fileName?: string;
  accepted?: number;
  uploads?: UploadItem[];
}

export interface UploadItem {
  fileName: string;
  jobId: string;
  documentId: string;
  bullmqJobId?: string;
  pollUrl: string;
}

export interface BatchUploadResponse {
  accepted: number;
  uploads: UploadItem[];
  jobId?: string;
  documentId?: string;
  bullmqJobId?: string;
  pollUrl?: string;
  fileName?: string;
}

// ─── HTTP layer ───────────────────────────────────────────────────────────────

function isLoopbackApiUrl(value: string) {
  try {
    const base =
      typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const url = new URL(value, base);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function resolveApiUrl() {
  const configured = import.meta.env.VITE_API_URL?.trim();

  // In Vite dev, prefer the built-in proxy for loopback targets so the app
  // works the same from localhost, 127.0.0.1, and embedded browser surfaces.
  if (import.meta.env.DEV && (!configured || isLoopbackApiUrl(configured))) {
    return "/api";
  }

  return configured || "http://localhost:3001";
}

export const API_URL = resolveApiUrl();

/**
 * Lightweight fetch wrapper that handles auth headers and JSON parsing.
 */
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options?.headers ?? {});
  const hasBody = options?.body !== undefined && options?.body !== null;
  const isFormData =
    typeof FormData !== "undefined" && options?.body instanceof FormData;

  if (hasBody && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
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

export interface UploadOptions {
  company?: string;
}

export async function uploadFile(
  file: File,
  opts: UploadOptions = {}
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (opts.company?.trim()) formData.append("company", opts.company.trim());

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

export async function uploadFiles(
  files: File[],
  opts: UploadOptions = {}
): Promise<BatchUploadResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  if (opts.company?.trim()) formData.append("company", opts.company.trim());

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

  return res.json() as Promise<BatchUploadResponse>;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * GET /incidents — list all incidents (summary only).
 * The API returns a paginated envelope { data, total, page, limit };
 * we unwrap .data here so all consumers get a plain Incident[].
 */
export function getIncidents(params?: {
  page?: number;
  limit?: number;
}): Promise<Incident[]> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));

  const path = qs.size > 0 ? `/incidents?${qs.toString()}` : "/incidents";
  return request<PaginatedResponse<Incident>>(path).then((res) => {
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

/** GET /metadata/companies — get unique list of companies */
export function getMetadataCompanies(): Promise<string[]> {
  return request<string[]>("/metadata/companies");
}

/** GET /metadata/severities — get unique list of severities */
export function getMetadataSeverities(): Promise<string[]> {
  return request<string[]>("/metadata/severities");
}

/** GET /metadata/tags — get unique list of tags */
export function getMetadataTags(): Promise<string[]> {
  return request<string[]>("/metadata/tags");
}

/** GET /metadata/nodes — get unique list of graph node names */
export function getMetadataNodes(type?: string): Promise<string[]> {
  const qs = type ? `?type=${encodeURIComponent(type)}` : "";
  return request<string[]>(`/metadata/nodes${qs}`);
}

/**
 * GET /search?q=…&company=…&severity=…&tag=…&page=…&limit=…
 * Hybrid FTS + vector search. Returns scored results with evidence snippets.
 */
export function searchIncidents(params: SearchParams): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.scope?.source) qs.set("source", params.scope.source);
  if (params.scope?.companies?.length)
    qs.set("companies", params.scope.companies.join(","));
  if (params.filterCompany) qs.set("company", params.filterCompany);
  if (params.filterSeverity) qs.set("severity", params.filterSeverity);
  if (params.filterTag) qs.set("tag", params.filterTag);
  if (params.filterFrom) qs.set("from", params.filterFrom);
  if (params.filterTo) qs.set("to", params.filterTo);
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
 * POST /qa/stream
 * Same contract as postQa, but streams generated tokens live over SSE (W6-033)
 * via `onToken` while the model is still writing; resolves with the same
 * citation-validated QaResponse once the "done" event lands. Falls back to a
 * single "done" event with no intermediate tokens when the backend isn't
 * running the streaming Ollama path (e.g. QA_PROVIDER=local).
 */
export async function streamQa(
  payload: QaPayload,
  onToken?: (token: string) => void
): Promise<QaResponse> {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (ADMIN_TOKEN) headers.Authorization = `Bearer ${ADMIN_TOKEN}`;

  const res = await fetch(`${API_URL}/qa/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let message = `Request failed: ${res.status}`;
    try {
      const data = JSON.parse(text);
      if (data && typeof data.error === "string") message = data.error;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let frameEnd;
    while ((frameEnd = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      const lines = frame.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLine = lines.find((line) => line.startsWith("data:"));
      if (!eventLine || !dataLine) continue;

      const event = eventLine.slice(6).trim();
      const data = JSON.parse(dataLine.slice(5).trim());

      if (event === "token") onToken?.(data.token);
      else if (event === "done") return data as QaResponse;
      else if (event === "error") throw new Error(data.error ?? "Streaming failed");
    }
  }

  throw new Error("Stream ended without a final response");
}

/**
 * POST /qa/:auditId/feedback
 * Record a thumbs up/down against a Q&A answer's audit log row (W6-032).
 */
export function postQaFeedback(
  auditId: string,
  helpful: boolean
): Promise<{ auditId: string; helpful: boolean }> {
  const headers: HeadersInit = {};
  if (ADMIN_TOKEN) headers.Authorization = `Bearer ${ADMIN_TOKEN}`;

  return request<{ auditId: string; helpful: boolean }>(
    `/qa/${encodeURIComponent(auditId)}/feedback`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ helpful }),
    }
  );
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

// ── Client-side acronym hint utility ──────────────────────────────────────────
// Mirrors packages/nlp/src/acronyms.js but runs in-browser with no network call.

const ACRONYM_HINT_MAP: Record<string, string> = {
  k8s: "kubernetes",
  kube: "kubernetes",
  s3: "aws s3 object storage",
  ec2: "aws ec2 instance",
  rds: "aws rds database",
  elb: "elastic load balancer",
  alb: "application load balancer",
  ecs: "elastic container service",
  eks: "elastic kubernetes",
  oom: "out of memory",
  cpu: "cpu processor compute",
  ssl: "ssl tls certificate",
  tls: "tls ssl certificate",
  dns: "dns domain name",
  cdn: "cdn content delivery",
  slo: "service level objective",
  sla: "service level agreement",
  sli: "service level indicator",
  mttr: "mean time to recover",
  rca: "root cause analysis",
  sev1: "severity 1 critical",
  sev2: "severity 2 major",
  p99: "p99 tail latency percentile",
  cicd: "ci/cd pipeline deployment",
};

/**
 * Client-side acronym hint utility.
 *
 * Returns a list of { acronym, suggestion } pairs for tokens found in the query
 * that match known SRE/DevOps acronyms. Used by the Search UI to show expansion
 * hints below the search bar.
 *
 * @param query - Raw user query string
 * @returns Array of hint objects
 */
export function getAcronymHints(
  query: string
): Array<{ acronym: string; suggestion: string }> {
  const tokens = query.toLowerCase().match(/[a-z0-9][a-z0-9/_.-]*/g) ?? [];
  const hints: Array<{ acronym: string; suggestion: string }> = [];

  for (const token of tokens) {
    const key = token.replace(/[^a-z0-9-]/g, "");
    const suggestion = ACRONYM_HINT_MAP[key];
    if (suggestion && suggestion !== key) {
      hints.push({ acronym: key, suggestion });
    }
  }

  return hints;
}
