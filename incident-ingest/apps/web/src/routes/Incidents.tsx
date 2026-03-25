import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getIncidents, type Incident } from "../lib/api";

function formatDate(date: string | null) {
  if (!date) return null;
  const v = new Date(date);
  if (Number.isNaN(v.getTime())) return null;
  return v.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function getSeverityVariant(severity: string | null): string {
  if (!severity) return "";
  const s = severity.toLowerCase();
  if (s.includes("1") || s.includes("critical")) return "badge-danger";
  if (s.includes("2") || s.includes("high")) return "badge-warning";
  if (s.includes("3") || s.includes("med")) return "badge-info";
  return "badge-success";
}

function getSevDotClass(severity: string | null) {
  if (!severity) return "sev-unknown";
  const s = severity.toLowerCase();
  if (s.includes("1") || s.includes("critical")) return "sev-1";
  if (s.includes("2") || s.includes("high")) return "sev-2";
  if (s.includes("3") || s.includes("med")) return "sev-3";
  return "sev-4";
}

function IncidentRow({ incident }: { incident: Incident }) {
  const date = formatDate(incident.date);

  return (
    <Link
      id={`incident-${incident.id}`}
      className="incident-row card"
      to={`/incidents/${incident.id}`}
      style={{ textDecoration: "none" }}
    >
      <div
        className={`incident-sev-dot ${getSevDotClass(incident.severity)}`}
        style={{ flexShrink: 0 }}
        title={incident.severity || "Unknown severity"}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="incident-title">{incident.title}</div>
        <div className="incident-meta">
          {incident.company && <span>{incident.company}</span>}
          {date && <span>{date}</span>}
          {incident.tags && incident.tags.length > 0 && (
            <span style={{ display: "flex", gap: 4 }}>
              {incident.tags.slice(0, 3).map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
            </span>
          )}
        </div>
        {incident.summaryText && (
          <div className="incident-summary">{incident.summaryText}</div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
        {incident.severity && (
          <span className={`badge ${getSeverityVariant(incident.severity)}`}>
            {incident.severity}
          </span>
        )}
        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>→</span>
      </div>
    </Link>
  );
}

const ALL_COMPANIES_LABEL = "All Companies";

export default function Incidents() {
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState(ALL_COMPANIES_LABEL);

  const { data, isLoading, error, refetch } = useQuery<Incident[]>({
    queryKey: ["incidents"],
    queryFn: getIncidents,
  });

  const companies = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.map((i) => i.company).filter((c): c is string => Boolean(c)));
    return [ALL_COMPANIES_LABEL, ...Array.from(set).sort()];
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((incident) => {
      const matchesQuery =
        !query ||
        incident.title.toLowerCase().includes(query.toLowerCase()) ||
        (incident.summaryText || "").toLowerCase().includes(query.toLowerCase()) ||
        (incident.company || "").toLowerCase().includes(query.toLowerCase());
      const matchesCompany =
        companyFilter === ALL_COMPANIES_LABEL ||
        incident.company === companyFilter;
      return matchesQuery && matchesCompany;
    });
  }, [data, query, companyFilter]);

  return (
    <section className="fade-in">
      <div className="page-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Incidents</h1>
            <p>Browse and search all ingested incident reports.</p>
          </div>
          <Link className="btn btn-primary" to="/upload" id="upload-new-btn">
            ⊕ Upload New
          </Link>
        </div>
      </div>

      {/* Search */}
      <div className="search-bar">
        <span className="search-icon">🔍</span>
        <input
          id="incidents-search"
          type="search"
          placeholder="Search by title, company, or summary…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search incidents"
        />
      </div>

      {/* Company filter chips */}
      {companies.length > 1 && (
        <div className="filters-row" role="group" aria-label="Filter by company">
          {companies.map((co) => (
            <button
              key={co}
              id={`filter-company-${co.toLowerCase().replace(/\s+/g, "-")}`}
              className={`filter-chip${companyFilter === co ? " active" : ""}`}
              onClick={() => setCompanyFilter(co)}
            >
              {co}
            </button>
          ))}
        </div>
      )}

      {/* Summary line */}
      {!isLoading && data && (
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 14 }}>
          {filtered.length} of {data.length} incident{data.length !== 1 ? "s" : ""}
          {query && ` matching "${query}"`}
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="skeleton" style={{ height: 80, borderRadius: 16 }} />
          ))}
        </div>
      )}

      {/* Error */}
      {error instanceof Error && (
        <div className="alert alert-error" id="incidents-error">
          <span>⚠️</span>
          <div>
            <strong>Could not load incidents.</strong>{" "}
            {error.message}{" "}
            <button
              className="btn btn-secondary"
              onClick={() => refetch()}
              style={{ marginLeft: 8, padding: "3px 10px", fontSize: "0.75rem" }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Empty / no results */}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🗂</div>
            <h3>{data && data.length > 0 ? "No matching incidents" : "No incidents yet"}</h3>
            <p>
              {data && data.length > 0
                ? "Try adjusting your search or filters."
                : "Use the Manual Upload page to ingest your first incident report."}
            </p>
            {!data?.length && (
              <Link className="btn btn-primary" to="/upload" style={{ marginTop: 10 }}>
                Upload an Incident
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {filtered.length > 0 && (
        <div className="incident-list" id="incident-list">
          {filtered.map((incident) => (
            <IncidentRow key={incident.id} incident={incident} />
          ))}
        </div>
      )}
    </section>
  );
}
