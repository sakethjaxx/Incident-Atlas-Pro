import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { searchIncidents, type ScopeSource, type SearchResult, getMetadataCompanies, getMetadataTags, getMetadataSeverities, getAcronymHints } from "../lib/api";
import Icon from "../components/Icon";

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
            {result.sourceAccess && <span className="badge badge-info">{result.sourceAccess.label}</span>}
          </div>
        </div>
        <div className="search-score-stack">
          <span className="badge badge-brand">{formatPercent(result.score)} score</span>
        </div>
      </div>

      {incident.summaryText && <div className="incident-summary">{incident.summaryText}</div>}
      {result.sourceAccess && (
        <div className="source-access-line">
          <Icon name="checkCircle" size={14} />
          <span>{result.sourceAccess.accessReason}</span>
        </div>
      )}
      <EvidenceList result={result} />
    </Link>
  );
}

export default function Search() {
  const [query, setQuery] = useState("");
  const [scopeSource, setScopeSource] = useState<ScopeSource>("uploaded_documents");
  const [company, setCompany] = useState("");
  const [severity, setSeverity] = useState("");
  const [tag, setTag] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [submitted, setSubmitted] = useState({
    q: "",
    scopeSource: "uploaded_documents" as ScopeSource,
    company: "",
    severity: "",
    tag: "",
    from: "",
    to: "",
  });

  const hasSubmittedQuery = submitted.q.trim().length > 0;

  const { data: companiesData } = useQuery({ queryKey: ["metadata-companies"], queryFn: getMetadataCompanies, retry: false });
  const { data: tagsData } = useQuery({ queryKey: ["metadata-tags"], queryFn: getMetadataTags, retry: false });
  const { data: severitiesData } = useQuery({ queryKey: ["metadata-severities"], queryFn: getMetadataSeverities, retry: false });

  const companiesList = companiesData ?? [];
  const tagsList = tagsData ?? [];
  const severitiesList = severitiesData?.length ? severitiesData : ["SEV-1", "SEV-2", "SEV-3", "SEV-4"];

  const { data, isLoading, error, refetch, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["search", submitted],
    initialPageParam: 1,
    queryFn: ({ pageParam = 1 }) =>
      searchIncidents({
        q: submitted.q,
        scope: {
          source: submitted.scopeSource,
          companies: submitted.company ? [submitted.company] : undefined,
        },
        filterCompany: submitted.company || undefined,
        filterSeverity: submitted.severity || undefined,
        filterTag: submitted.tag || undefined,
        filterFrom: submitted.from ? new Date(`${submitted.from}T00:00:00`).toISOString() : undefined,
        filterTo: submitted.to ? new Date(`${submitted.to}T23:59:59`).toISOString() : undefined,
        limit: 20,
        page: pageParam,
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.page * lastPage.limit < lastPage.total) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    enabled: hasSubmittedQuery,
    retry: false,
  });

  const results = useMemo(() => data?.pages.flatMap((p) => p.results) ?? [], [data]);
  const totalResults = data?.pages[0]?.total ?? 0;
  const publicWeb = data?.pages[0]?.publicWeb;
  const responseScope = data?.pages[0]?.scope;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted({
      q: query.trim(),
      scopeSource,
      company: company.trim(),
      severity: severity.trim(),
      tag: tag.trim(),
      from: fromDate,
      to: toDate,
    });
  }

  return (
    <section className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-title">
            <h1>Search</h1>
            <p>Find previous incidents by symptom, root cause, service, or fix.</p>
          </div>
          <div className="page-header-actions">
            <Link className="btn btn-secondary" to="/incidents">
              <Icon name="incidents" size={16} />
              Incidents
            </Link>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="search-form-panel">
        <div className="search-bar" style={{ marginBottom: 0 }}>
          <span className="search-icon">
            <Icon name="search" size={16} />
          </span>
          <input
            id="search-query"
            type="search"
            placeholder="database timeout, cache stampede, k8s oom, s3 access denied"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search incidents"
          />
        </div>

        {/* Acronym expansion hints */}
        {query.trim() && (() => {
          const hints = getAcronymHints(query);
          return hints.length > 0 ? (
            <div className="acronym-hints" aria-label="Query expansions" style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0" }}>
              <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", alignSelf: "center" }}>Expanding:</span>
              {hints.map((h) => (
                <span key={h.acronym} className="badge badge-info" style={{ fontSize: "0.72rem" }}>
                  {h.acronym} → {h.suggestion}
                </span>
              ))}
            </div>
          ) : null;
        })()}

        <div className="scope-segmented" role="group" aria-label="Search source">
          <button
            type="button"
            aria-pressed={scopeSource === "uploaded_documents"}
            className={scopeSource === "uploaded_documents" ? "active" : ""}
            onClick={() => setScopeSource("uploaded_documents")}
          >
            <Icon name="inbox" size={15} />
            Uploaded documents
          </button>
          <button
            type="button"
            aria-pressed={scopeSource === "public_web"}
            className={scopeSource === "public_web" ? "active" : ""}
            onClick={() => setScopeSource("public_web")}
          >
            <Icon name="search" size={15} />
            Public web
          </button>
        </div>

        <div className="search-form-grid">
          <div className="field-stack">
            <label htmlFor="search-company">Company</label>
            <input
              id="search-company"
              className="form-input"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              placeholder={scopeSource === "public_web" ? "Public company" : "Allowed company"}
              aria-label="Filter by company"
              list="search-companies-list"
            />
            <datalist id="search-companies-list">
              {companiesList.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="field-stack">
            <label htmlFor="search-severity">Severity</label>
            <input
              id="search-severity"
              className="form-input"
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              placeholder="SEV-1"
              aria-label="Filter by severity"
              list="search-severities-list"
            />
            <datalist id="search-severities-list">
              {severitiesList.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div className="field-stack">
            <label htmlFor="search-tag">Tag</label>
            <input
              id="search-tag"
              className="form-input"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              placeholder="database"
              aria-label="Filter by tag"
              list="search-tags-list"
            />
            <datalist id="search-tags-list">
              {tagsList.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div className="field-stack">
            <label htmlFor="search-from">From</label>
            <input
              id="search-from"
              className="form-input"
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              aria-label="Filter from date"
            />
          </div>
          <div className="field-stack">
            <label htmlFor="search-to">To</label>
            <input
              id="search-to"
              className="form-input"
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              aria-label="Filter to date"
            />
          </div>
          <div className="field-stack">
            <label htmlFor="search-submit">Run</label>
            <button id="search-submit" className="btn btn-primary" type="submit" disabled={!query.trim()}>
              <Icon name="search" size={16} />
              {isFetching && !isFetchingNextPage ? "Searching..." : "Search"}
            </button>
          </div>
        </div>
      </form>

      {hasSubmittedQuery && !isLoading && !error && (
        <div className="search-summary-line" role="status" aria-live="polite">
          {totalResults} result{totalResults === 1 ? "" : "s"} for "{submitted.q}"
          {" - "}
          {responseScope?.source === "public_web" ? "Public web" : "Uploaded documents"}
        </div>
      )}

      {publicWeb && (
        <div className="alert alert-info" style={{ marginBottom: 14 }}>
          <Icon name="search" size={18} />
          <div>
            <strong>Public web unavailable.</strong> {publicWeb.message}
          </div>
        </div>
      )}

      {!hasSubmittedQuery && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name="search" size={28} />
            </div>
            <h3>Search the incident memory</h3>
            <p>Try a symptom, failure mode, service name, or fix.</p>
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
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={18} />
          <div>
            <strong>Search failed.</strong> {error.message}
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

      {!isLoading && !error && hasSubmittedQuery && results.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name="inbox" size={28} />
            </div>
            <h3>No matching incidents</h3>
            <p>
              {submitted.company || submitted.severity || submitted.tag || submitted.from || submitted.to
                ? "Try a broader term, or try clearing some of your filters."
                : "Try a broader term, or search with the user-visible symptom instead of the root cause."}
            </p>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <>
          <div className="search-results-list">
            {results.map((result) => (
              <SearchResultCard key={result.incident.id} result={result} />
            ))}
          </div>
          {hasNextPage && (
            <div style={{ marginTop: 24, textAlign: "center" }}>
              <button
                className="btn btn-secondary"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading more..." : "Load More"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
