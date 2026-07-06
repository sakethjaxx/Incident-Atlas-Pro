import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getIncidents, type Incident } from "../lib/api";
import Icon from "../components/Icon";

function formatDate(date: string | null) {
  if (!date) return null;
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  return value.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function getSeverityVariant(severity: string | null): string {
  if (!severity) return "";
  const normalized = severity.toLowerCase();
  if (normalized.includes("1") || normalized.includes("critical")) return "badge-danger";
  if (normalized.includes("2") || normalized.includes("high")) return "badge-warning";
  if (normalized.includes("3") || normalized.includes("med")) return "badge-info";
  return "badge-success";
}

function getSevDotClass(severity: string | null) {
  if (!severity) return "sev-unknown";
  const normalized = severity.toLowerCase();
  if (normalized.includes("1") || normalized.includes("critical")) return "sev-1";
  if (normalized.includes("2") || normalized.includes("high")) return "sev-2";
  if (normalized.includes("3") || normalized.includes("med")) return "sev-3";
  return "sev-4";
}

function IncidentRow({ incident }: { incident: Incident }) {
  const date = formatDate(incident.date);

  return (
    <tr id={`incident-${incident.id}`} className="incident-table-row">
      <td>
        <Link className="incident-table-title" to={`/incidents/${incident.id}`}>
          <span
            className={`incident-sev-dot ${getSevDotClass(incident.severity)}`}
            title={incident.severity || "Unknown severity"}
          />
          <span>
            <span className="incident-title">{incident.title}</span>
            {incident.summaryText && <span className="incident-summary">{incident.summaryText}</span>}
          </span>
        </Link>
      </td>
      <td>{incident.company || "-"}</td>
      <td>{incident.severity ? <span className={`badge ${getSeverityVariant(incident.severity)}`}>{incident.severity}</span> : "-"}</td>
      <td>{date || "-"}</td>
      <td>
        {incident.tags && incident.tags.length > 0 ? (
          <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {incident.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
            ))}
          </span>
        ) : (
          "-"
        )}
      </td>
      <td className="incident-table-open">
        <Link to={`/incidents/${incident.id}`} aria-label={`Open ${incident.title}`}>
          <Icon name="arrowRight" size={14} />
        </Link>
      </td>
    </tr>
  );
}

const ALL_COMPANIES_LABEL = "All Companies";

export default function Incidents() {
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState(ALL_COMPANIES_LABEL);

  const { data, isLoading, error, refetch } = useQuery<Incident[]>({
    queryKey: ["incidents"],
    queryFn: () => getIncidents(),
    retry: false,
  });

  const companies = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.map((incident) => incident.company).filter((company): company is string => Boolean(company)));
    return [ALL_COMPANIES_LABEL, ...Array.from(set).sort()];
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((incident) => {
      const normalizedQuery = query.toLowerCase();
      const matchesQuery =
        !query ||
        incident.title.toLowerCase().includes(normalizedQuery) ||
        (incident.summaryText || "").toLowerCase().includes(normalizedQuery) ||
        (incident.company || "").toLowerCase().includes(normalizedQuery);
      const matchesCompany = companyFilter === ALL_COMPANIES_LABEL || incident.company === companyFilter;
      return matchesQuery && matchesCompany;
    });
  }, [data, query, companyFilter]);

  return (
    <section className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-title">
            <h1>Incidents</h1>
            <p>Browse and filter the incident archive.</p>
          </div>
          <div className="page-header-actions">
            <Link className="btn btn-primary" to="/upload" id="upload-new-btn">
              <Icon name="upload" size={16} />
              Upload
            </Link>
          </div>
        </div>
      </div>

      <div className="search-bar">
        <span className="search-icon">
          <Icon name="search" size={16} />
        </span>
        <input
          id="incidents-search"
          type="search"
          placeholder="Search by title, company, or summary..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search incidents"
        />
      </div>

      {companies.length > 1 && (
        <div className="filters-row" role="group" aria-label="Filter by company">
          {companies.map((company) => (
            <button
              key={company}
              id={`filter-company-${company.toLowerCase().replace(/\s+/g, "-")}`}
              type="button"
              className={`filter-chip${companyFilter === company ? " active" : ""}`}
              onClick={() => setCompanyFilter(company)}
            >
              {company}
            </button>
          ))}
        </div>
      )}

      {!isLoading && data && !error && (
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 14 }}>
          {filtered.length} of {data.length} incident{data.length !== 1 ? "s" : ""}
          {query && ` matching "${query}"`}
        </div>
      )}

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="skeleton" style={{ height: 80, borderRadius: 16 }} />
          ))}
        </div>
      )}

      {error instanceof Error && (
        <div className="alert alert-error" id="incidents-error">
          <Icon name="alert" size={18} />
          <div>
            <strong>Could not load incidents.</strong> {error.message}
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => refetch()}
              style={{ marginLeft: 8, padding: "3px 10px", fontSize: "0.75rem" }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name={data && data.length > 0 ? "search" : "inbox"} size={28} />
            </div>
            <h3>{data && data.length > 0 ? "No matching incidents" : "No incidents yet"}</h3>
            <p>
              {data && data.length > 0
                ? "Try a broader search term or clear the company filter."
                : "Use the manual upload page to ingest your first incident report."}
            </p>
            {!data?.length && (
              <Link className="btn btn-primary" to="/upload" style={{ marginTop: 10 }}>
                <Icon name="upload" size={16} />
                Upload an Incident
              </Link>
            )}
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="card table-card" id="incident-list">
          <table className="data-table incident-table">
            <thead>
              <tr>
                <th>Incident</th>
                <th>Company</th>
                <th>Severity</th>
                <th>Date</th>
                <th>Tags</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((incident) => (
                <IncidentRow key={incident.id} incident={incident} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
