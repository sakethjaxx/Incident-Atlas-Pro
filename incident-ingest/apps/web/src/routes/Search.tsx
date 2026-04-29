import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  searchIncidents,
  type SearchResult,
} from "../lib/api";

function formatPercent(value: number) {
  return Math.max(0, Math.min(99, Math.round(value * 100)));
}

function formatDate(date: string | null) {
  if (!date) return null;
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  return value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function EvidenceList({ result }: { result: SearchResult }) {
  const sections = result.evidence ?? [];
  if (sections.length === 0) return null;

  return (
    <div className="evidence-list">
      {sections.map((section) => (
        <div key={section.id} className="evidence-item">
          <div className="evidence-header">
            <span className="badge">{section.type}</span>
            {typeof section.score === "number" && (
              <span className="evidence-score">{formatPercent(section.score)}%</span>
            )}
          </div>
          <p>{section.highlight || section.text}</p>
        </div>
      ))}
    </div>
  );
}

function SearchResultCard({ result }: { result: SearchResult }) {
  const incident = result.incident ?? result;

  return (
    <Link
      to={`/incidents/${incident.id}`}
      className="search-result card"
      style={{ textDecoration: "none" }}
    >
      <div className="search-result-header">
        <div style={{ minWidth: 0 }}>
          <div className="incident-title">{incident.title}</div>
          <div className="incident-meta">
            {incident.company && <span>{incident.company}</span>}
            {incident.date && <span>{formatDate(incident.date)}</span>}
            {incident.severity && <span className="badge badge-warning">{incident.severity}</span>}
          </div>
        </div>
        <div className="search-score-stack">
          <span className="badge badge-brand">{formatPercent(result.score)} score</span>
          {(result.keywordScore != null || result.vectorScore != null) && (
            <span className="search-score-sub">
              {result.keywordScore != null ? `${formatPercent(result.keywordScore)} kw` : null}
              {result.keywordScore != null && result.vectorScore != null ? " / " : null}
              {result.vectorScore != null ? `${formatPercent(result.vectorScore)} vec` : null}
            </span>
          )}
        </div>
      </div>

      {incident.summaryText && <div className="incident-summary">{incident.summaryText}</div>}
      <EvidenceList result={result} />
    </Link>
  );
}

export default function Search() {
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [severity, setSeverity] = useState("");
  const [tag, setTag] = useState("");
  const [submitted, setSubmitted] = useState({
    q: "",
    company: "",
    severity: "",
    tag: "",
  });

  const hasSubmittedQuery = submitted.q.trim().length > 0;

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["search", submitted],
    queryFn: () =>
      searchIncidents({
        q: submitted.q,
        filterCompany: submitted.company || undefined,
        filterSeverity: submitted.severity || undefined,
        filterTag: submitted.tag || undefined,
        limit: 20,
      }),
    enabled: hasSubmittedQuery,
    retry: false,
  });

  const results = useMemo(() => data?.results ?? [], [data]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted({
      q: query.trim(),
      company: company.trim(),
      severity: severity.trim(),
      tag: tag.trim(),
    });
  }

  return (
    <section className="fade-in">
      <div className="page-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <h1>Search</h1>
            <p>Find past incidents and jump straight to evidence.</p>
          </div>
          <Link className="btn btn-secondary" to="/incidents">
            Browse Incidents
          </Link>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="search-form-panel">
        <div className="search-bar" style={{ marginBottom: 0 }}>
          <span className="search-icon">?</span>
          <input
            id="search-query"
            type="search"
            placeholder="database timeout, cache stampede, deploy rollback..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search incidents"
          />
        </div>

        <div className="search-form-grid">
          <input
            className="form-input"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="Company"
            aria-label="Filter by company"
          />
          <input
            className="form-input"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            placeholder="Severity"
            aria-label="Filter by severity"
          />
          <input
            className="form-input"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            placeholder="Tag"
            aria-label="Filter by tag"
          />
          <button className="btn btn-primary" type="submit" disabled={!query.trim()}>
            {isFetching ? "Searching..." : "Run Search"}
          </button>
        </div>
      </form>

      {hasSubmittedQuery && !isLoading && !error && (
        <div className="search-summary-line">
          {data?.total ?? 0} result{(data?.total ?? 0) === 1 ? "" : "s"} for "{submitted.q}"
        </div>
      )}

      {!hasSubmittedQuery && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">/</div>
            <h3>Search the incident memory</h3>
            <p>Try a symptom, a failure mode, or a fix.</p>
          </div>
        </div>
      )}

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map((n) => (
            <div key={n} className="skeleton" style={{ height: 160, borderRadius: 16 }} />
          ))}
        </div>
      )}

      {error instanceof Error && (
        <div className="alert alert-error">
          <span>!</span>
          <div>
            <strong>Search failed.</strong> {error.message}
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

      {!isLoading && !error && hasSubmittedQuery && results.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">0</div>
            <h3>No matching incidents</h3>
            <p>Try a broader term or remove one of the filters.</p>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="search-results-list">
          {results.map((result) => (
            <SearchResultCard key={result.incident.id} result={result} />
          ))}
        </div>
      )}
    </section>
  );
}
