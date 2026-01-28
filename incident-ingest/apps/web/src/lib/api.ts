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

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
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
      } catch (error) {
        message = text;
      }
    }
    throw new Error(message);
  }

  return res.json();
}

export function getIncidents(): Promise<Incident[]> {
  return request("/incidents");
}

export function getIncident(id: string): Promise<IncidentDetail> {
  return request(`/incidents/${id}`);
}

export function createManualIncident(
  payload: ManualIngestPayload
): Promise<IncidentDetail> {
  return request("/ingest/manual", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
