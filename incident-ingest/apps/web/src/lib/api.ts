// ─── Domain types ────────────────────────────────────────────────────────────

export type SectionType = "impact" | "timeline" | "rootcause" | "fix";

export interface Section {
  id: string;
  incidentId: string;
  type: SectionType;
  text: string;
}

export interface Incident {
  id: string;
  title: string;
  date: string | null;
  company: string | null;
  severity: string | null;
  tags: string[];
  summaryText: string | null;
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

// Paginated API envelope — GET /incidents returns this shape
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// Sprint 2 — search
export interface SearchResult {
  incident: Incident;
  score: number;
  matchedSections: (Section & { highlight?: string })[];
}

export interface SearchParams {
  q: string;
  filterCompany?: string;
  filterSeverity?: string;
  page?: number;
}

// Sprint 2 — similar incidents
export interface SimilarIncident extends Incident {
  similarityReason: string;
  score: number;
}

// ─── HTTP layer ───────────────────────────────────────────────────────────────

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
    headers["Authorization"] = `Bearer ${ADMIN_TOKEN}`;
  }

  const res = await fetch(`${API_URL}/ingest/upload`, {
    method: "POST",
    body: formData,
    headers,
    // Note: Do NOT set Content-Type header. The browser automatically sets it
    // to multipart/form-data with the correct boundary parameter.
  });

  if (!res.ok) {
    let message = `Upload failed: ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data.error === "string") {
        message = data.error;
      }
    } catch {
      // Ignore
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
    // Defensive: handle both the paginated envelope AND a bare array
    // (bare array is returned by the legacy index.js path that some
    //  test environments may still hit).
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

// ─── Sprint 2 stubs (will be wired once API endpoints exist) ─────────────────

/** GET /search?q=… — hybrid keyword+vector search */
export function searchIncidents(
  params: SearchParams
): Promise<SearchResult[]> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.filterCompany) qs.set("filter_company", params.filterCompany);
  if (params.filterSeverity) qs.set("filter_severity", params.filterSeverity);
  if (params.page) qs.set("page", String(params.page));
  return request<SearchResult[]>(`/search?${qs.toString()}`);
}

/** GET /incidents/:id/similar — similar incidents with reasons */
export function getSimilarIncidents(id: string): Promise<SimilarIncident[]> {
  return request<SimilarIncident[]>(`/incidents/${id}/similar`);
}

/** GET /health — API health check */
export function getHealth(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/health");
}
