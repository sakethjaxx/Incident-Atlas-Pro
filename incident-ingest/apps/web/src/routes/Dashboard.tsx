import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  getIncident,
  getIncidents,
  getSimilarIncidents,
  getMetadataCompanies,
  getMetadataTags,
  getMetadataSeverities,
  postQa,
  searchIncidents,
  type Incident,
  type IncidentDetail,
  type QaResponse,
  type SearchResult,
  type SimilarIncidentResult,
} from "../lib/api";
import Icon from "../components/Icon";

type TimePreset = "24h" | "7d" | "30d" | "all" | "custom";

type SubmittedSearch = {
  raw: string;
  q: string;
  company: string;
  severity: string;
  tag: string;
  from?: string;
  to?: string;
  windowLabel: string;
};

const SEVERITY_OPTIONS = ["SEV-1", "SEV-2", "SEV-3", "SEV-4"];

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

function formatMatchPercent(value: number) {
  return Math.max(0, Math.min(99, Math.round(value * 100)));
}

function formatRelativeDate(date: string | null) {
  if (!date) return "No incident date";
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "No incident date";

  const deltaMs = Date.now() - value.getTime();
  const deltaHours = Math.round(deltaMs / (1000 * 60 * 60));
  if (deltaHours < 24) return `${deltaHours || 1}h ago`;
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function getSeverityClass(severity: string | null) {
  if (!severity) return "sev-unknown";
  const value = severity.toLowerCase();
  if (value.includes("1") || value.includes("critical")) return "sev-1";
  if (value.includes("2") || value.includes("high")) return "sev-2";
  if (value.includes("3") || value.includes("med")) return "sev-3";
  return "sev-4";
}

function truncateText(value: string, length = 180) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= length) return clean;
  return `${clean.slice(0, length - 3)}...`;
}

function detectLogPaste(value: string) {
  return value.includes("\n") || /(exception|stack trace|timeout|refused|panic|traceback|error:|failed)/i.test(value);
}

function normalizeIncidentQuery(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const preferred = lines.filter((line) =>
    /(exception|timeout|refused|panic|traceback|error|failed|rollback|503|502|500)/i.test(line)
  );

  const selected = (preferred.length > 0 ? preferred : lines).slice(0, 6).join(" ");
  return truncateText(selected || value.trim(), 500);
}

function buildTimeWindow(preset: TimePreset, customFrom: string, customTo: string) {
  const now = new Date();
  const end = new Date(now);

  if (preset === "all") {
    return { from: undefined, to: undefined, label: "All time" };
  }

  if (preset === "custom") {
    const from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
    const to = customTo ? new Date(`${customTo}T23:59:59`) : null;
    return {
      from: from && !Number.isNaN(from.getTime()) ? from.toISOString() : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to.toISOString() : undefined,
      label: customFrom || customTo ? "Custom window" : "Custom window (unset)",
    };
  }

  const start = new Date(now);
  if (preset === "24h") start.setHours(start.getHours() - 24);
  if (preset === "7d") start.setDate(start.getDate() - 7);
  if (preset === "30d") start.setDate(start.getDate() - 30);

  return {
    from: start.toISOString(),
    to: end.toISOString(),
    label:
      preset === "24h" ? "Last 24 hours" : preset === "7d" ? "Last 7 days" : "Last 30 days",
  };
}

function getRootCauseSnippet(result: SearchResult | null) {
  if (!result) return null;
  const rootCause = result.evidence.find((section) => section.type === "rootcause");
  const preferred = rootCause ?? result.evidence[0];
  if (preferred?.highlight) return preferred.highlight;
  if (preferred?.text) return preferred.text;
  return result.incident.summaryText;
}

function getRunbookSection(detail: IncidentDetail | undefined) {
  if (!detail?.sections?.length) return null;
  return (
    detail.sections.find((section) => section.type === "fix") ??
    detail.sections.find((section) => section.type === "rootcause") ??
    detail.sections[0]
  );
}

function stripCitationLabels(value: string) {
  return value.replace(/\s*\[[^\]]+\]/g, "").trim();
}

function buildQaQuestion(raw: string) {
  return `What is the likely root cause and the most evidence-backed fix for this incident symptom: ${truncateText(raw, 420)}`;
}

function buildQuickFixBullets(
  topResult: SearchResult | null,
  runbookText: string | null,
  qaResponse: QaResponse | undefined
) {
  if (!topResult) return [];

  const bullets = [
    `Closest incident match: ${topResult.incident.title}.`,
    `Root-cause signal: ${truncateText(getRootCauseSnippet(topResult) ?? "No root-cause evidence surfaced yet.")}`,
  ];

  if (qaResponse?.status === "answered" && qaResponse.answer) {
    bullets.push(`Citations-first synthesis: ${truncateText(stripCitationLabels(qaResponse.answer), 180)}`);
  } else if (runbookText) {
    bullets.push(`Likely runbook step: ${truncateText(runbookText, 180)}`);
  } else {
    bullets.push("No fix section surfaced yet; inspect similar incidents and cited evidence.");
  }

  return bullets;
}

function countValues(items: Array<string | null | undefined>) {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item) continue;
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

async function copyText(value: string) {
  if (!navigator?.clipboard) return false;
  await navigator.clipboard.writeText(value);
  return true;
}

function SimilarIncidentAccordion({ incident }: { incident: SimilarIncidentResult }) {
  const highlight = incident.matchedSections[0]?.text;

  return (
    <details className="timeline-accordion">
      <summary className="timeline-accordion-summary">
        <div style={{ minWidth: 0 }}>
          <div className="incident-title">{incident.incident.title}</div>
          <div className="incident-meta">
            {incident.incident.company && <span>{incident.incident.company}</span>}
            {incident.incident.date && <span>{formatDate(incident.incident.date)}</span>}
          </div>
        </div>
        <span className="badge badge-brand">{formatMatchPercent(incident.score)}% match</span>
      </summary>

      <div className="timeline-accordion-body">
        <p>{incident.reason}</p>
        {highlight && <pre className="command-code-block">{truncateText(highlight, 220)}</pre>}
        <Link className="btn btn-secondary" to={`/incidents/${incident.incident.id}`}>
          <Icon name="arrowRight" size={16} />
          Open incident
        </Link>
      </div>
    </details>
  );
}

function EvidenceTimeline({ results }: { results: SearchResult[] }) {
  return (
    <div className="timeline-stream">
      {results.map((result) => {
        const lead = result.evidence[0];
        return (
          <Link
            key={result.incident.id}
            to={`/incidents/${result.incident.id}`}
            className="timeline-entry"
          >
            <div className={`timeline-entry-dot ${getSeverityClass(result.incident.severity)}`} />
            <div className="timeline-entry-body">
              <div className="timeline-entry-header">
                <div className="incident-title">{result.incident.title}</div>
                <span className="badge">{formatMatchPercent(result.score)}% score</span>
              </div>
              <div className="incident-meta">
                {result.incident.company && <span>{result.incident.company}</span>}
                {result.incident.severity && <span>{result.incident.severity}</span>}
                <span>{formatRelativeDate(result.incident.date)}</span>
              </div>
              {lead && (
                <p className="timeline-entry-copy">
                  <strong>{lead.type}</strong> {truncateText(lead.highlight || lead.text, 180)}
                </p>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const [queryText, setQueryText] = useState("");
  const [company, setCompany] = useState("");
  const [severity, setSeverity] = useState("");
  const [tag, setTag] = useState("");
  const [timePreset, setTimePreset] = useState<TimePreset>("24h");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [submitted, setSubmitted] = useState<SubmittedSearch | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const {
    data: incidents = [],
    isLoading: incidentsLoading,
    error: incidentsError,
    refetch: refetchIncidents,
  } = useQuery<Incident[]>({
    queryKey: ["incident-overview", 100],
    queryFn: () => getIncidents({ limit: 100 }),
    retry: false,
  });

  const searchQuery = useQuery({
    queryKey: ["command-search", submitted],
    queryFn: () =>
      searchIncidents({
        q: submitted!.q,
        filterCompany: submitted!.company || undefined,
        filterSeverity: submitted!.severity || undefined,
        filterTag: submitted!.tag || undefined,
        filterFrom: submitted!.from,
        filterTo: submitted!.to,
        limit: 6,
      }),
    enabled: submitted !== null,
    retry: false,
  });

  const searchResults = searchQuery.data?.results ?? [];
  const topResult = searchResults[0] ?? null;
  const topIncidentId = topResult?.incident.id ?? null;

  const similarQuery = useQuery({
    queryKey: ["command-similar", topIncidentId],
    queryFn: () => getSimilarIncidents(topIncidentId!),
    enabled: Boolean(topIncidentId),
    retry: false,
  });

  const detailQuery = useQuery({
    queryKey: ["command-detail", topIncidentId],
    queryFn: () => getIncident(topIncidentId!),
    enabled: Boolean(topIncidentId),
    retry: false,
  });

  const qaQuery = useQuery({
    queryKey: ["command-qa", submitted?.q, topIncidentId],
    queryFn: () =>
      postQa({
        question: buildQaQuestion(submitted!.raw),
        filters: {
          company: submitted!.company || topResult?.incident.company || undefined,
          tags: submitted!.tag ? [submitted!.tag] : undefined,
          incidentIds: searchResults.slice(0, 3).map((result) => result.incident.id),
        },
        options: {
          maxEvidenceSections: 6,
          includeGraphContext: true,
          mode: "answer",
        },
      }),
    enabled: Boolean(submitted && topIncidentId),
    retry: false,
  });

  const companiesQuery = useQuery({
    queryKey: ["metadata-companies"],
    queryFn: getMetadataCompanies,
    retry: false,
  });

  const tagsQuery = useQuery({
    queryKey: ["metadata-tags"],
    queryFn: getMetadataTags,
    retry: false,
  });

  const severitiesQuery = useQuery({
    queryKey: ["metadata-severities"],
    queryFn: getMetadataSeverities,
    retry: false,
  });

  const companies = companiesQuery.data ?? [];
  const tags = (tagsQuery.data ?? []).slice(0, 15);
  const severities = severitiesQuery.data?.length ? severitiesQuery.data : SEVERITY_OPTIONS;

  const recentIncidents = useMemo(
    () =>
      [...incidents]
        .sort((left, right) => {
          const leftDate = left.date ? new Date(left.date).getTime() : 0;
          const rightDate = right.date ? new Date(right.date).getTime() : 0;
          return rightDate - leftDate;
        })
        .slice(0, 4),
    [incidents]
  );

  const logPasteDetected = detectLogPaste(queryText);
  const rootCauseSnippet = getRootCauseSnippet(topResult);
  const runbookSection = getRunbookSection(detailQuery.data);
  const quickFixBullets = buildQuickFixBullets(topResult, runbookSection?.text ?? null, qaQuery.data);

  const totalIncidents = incidents.length;
  const uniqueCompanies = new Set(incidents.map((incident) => incident.company).filter(Boolean)).size;
  const taggedIncidents = incidents.filter((incident) => incident.tags.length > 0).length;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!queryText.trim()) return;

    const window = buildTimeWindow(timePreset, customFrom, customTo);
    setSubmitted({
      raw: queryText.trim(),
      q: normalizeIncidentQuery(queryText),
      company: company.trim(),
      severity: severity.trim(),
      tag: tag.trim(),
      from: window.from,
      to: window.to,
      windowLabel: window.label,
    });
    setCopiedSnippet(false);
  }

  function handleReset() {
    setCompany("");
    setSeverity("");
    setTag("");
    setTimePreset("24h");
    setCustomFrom("");
    setCustomTo("");
    setSubmitted(null);
  }

  async function handleCopySnippet() {
    if (!runbookSection?.text) return;
    const copied = await copyText(runbookSection.text);
    if (!copied) return;
    setCopiedSnippet(true);
    window.setTimeout(() => setCopiedSnippet(false), 1800);
  }

  return (
    <section className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-title">
            <h1>Home</h1>
            <p>Search incident history, review recent reports, and open the evidence behind each result.</p>
          </div>
          <div className="page-header-actions">
            <Link className="btn btn-secondary" to="/upload">
              <Icon name="upload" size={16} />
              Upload incident
            </Link>
            <Link className="btn btn-secondary" to="/search">
              <Icon name="search" size={16} />
              Search
            </Link>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="card stat-card">
          <div className="stat-label">
            <Icon name="database" size={14} />
            Incidents
          </div>
          <div className="stat-value">{incidentsLoading ? "--" : totalIncidents}</div>
          <div className="stat-sub">in archive</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">
            <Icon name="building" size={14} />
            Companies
          </div>
          <div className="stat-value">{incidentsLoading ? "--" : uniqueCompanies}</div>
          <div className="stat-sub">with filters</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">
            <Icon name="stack" size={14} />
            Tagged
          </div>
          <div className="stat-value">{incidentsLoading ? "--" : taggedIncidents}</div>
          <div className="stat-sub">with tags</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">
            <Icon name="pulse" size={14} />
            Search
          </div>
          <div className="stat-value">Hybrid</div>
          <div className="stat-sub">keyword + vector</div>
        </div>
      </div>

      {incidentsError instanceof Error && (
        <div className="alert alert-error" style={{ marginBottom: 18 }}>
          <Icon name="alert" size={18} />
          <div>
            <strong>Corpus overview unavailable.</strong> {incidentsError.message}
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => refetchIncidents()}
              style={{ marginLeft: 10, padding: "4px 12px", fontSize: "0.75rem" }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="command-center-layout">
        <div className="card command-panel">
          <div className="panel-heading">
            <h2>Search incidents</h2>
            {logPasteDetected && <span className="badge badge-warning">Multiline input</span>}
          </div>

          <form className="command-form" onSubmit={handleSubmit}>
            <div className="field-stack">
              <label htmlFor="incident-trigger">Symptom, error, service, or deploy note</label>
              <textarea
                id="incident-trigger"
                className="form-input form-textarea command-textarea"
                rows={8}
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                placeholder="checkout-api timeout connecting to db-primary after deploy"
              />
            </div>

            <div className="command-filter-block">
              <div className="command-filter-label">Company</div>
              <div className="filters-row">
                {companies.length === 0 ? (
                  <span className="badge">No company filters yet</span>
                ) : (
                  companies.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`filter-chip${company === value ? " active" : ""}`}
                      onClick={() => setCompany((current) => (current === value ? "" : value))}
                    >
                      {value}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="command-filter-block">
              <div className="command-filter-label">Severity</div>
              <div className="filters-row">
                {severities.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`filter-chip${severity === value ? " active" : ""}`}
                    onClick={() => setSeverity((current) => (current === value ? "" : value))}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <div className="command-filter-block">
              <div className="command-filter-label">Tag</div>
              <div className="filters-row">
                {tags.length === 0 ? (
                  <span className="badge">No tag filters yet</span>
                ) : (
                  tags.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`filter-chip${tag === value ? " active" : ""}`}
                      onClick={() => setTag((current) => (current === value ? "" : value))}
                    >
                      {value}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="command-filter-block">
              <div className="command-filter-label">Time window</div>
              <div className="filters-row">
                {[
                  { value: "24h" as TimePreset, label: "Last 24 hours" },
                  { value: "7d" as TimePreset, label: "Last 7 days" },
                  { value: "30d" as TimePreset, label: "Last 30 days" },
                  { value: "all" as TimePreset, label: "All time" },
                  { value: "custom" as TimePreset, label: "Custom" },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`filter-chip${timePreset === item.value ? " active" : ""}`}
                    onClick={() => setTimePreset(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {timePreset === "custom" && (
                <div className="command-date-grid">
                  <div className="field-stack">
                    <label htmlFor="command-from">From</label>
                    <input
                      id="command-from"
                      className="form-input"
                      type="date"
                      value={customFrom}
                      onChange={(event) => setCustomFrom(event.target.value)}
                    />
                  </div>
                  <div className="field-stack">
                    <label htmlFor="command-to">To</label>
                    <input
                      id="command-to"
                      className="form-input"
                      type="date"
                      value={customTo}
                      onChange={(event) => setCustomTo(event.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="command-actions">
              <button className="btn btn-primary" type="submit" disabled={!queryText.trim() || searchQuery.isFetching}>
                <Icon name="search" size={16} />
                {searchQuery.isFetching ? "Searching..." : "Search"}
              </button>
              <button className="btn btn-secondary" type="button" onClick={handleReset}>
                <Icon name="refresh" size={16} />
                Clear filters
              </button>
            </div>
          </form>

          <div className="command-footer">
            {submitted ? (
              <>
                <span className="badge badge-brand">Search submitted</span>
                <span className="command-footer-copy">{submitted.windowLabel}</span>
                {submitted.company && <span className="command-footer-copy">{submitted.company}</span>}
                {submitted.severity && <span className="command-footer-copy">{submitted.severity}</span>}
                {submitted.tag && <span className="command-footer-copy">#{submitted.tag}</span>}
              </>
            ) : (
              <span className="command-footer-copy">Use company, severity, tag, and date filters when you know the scope.</span>
            )}
          </div>
        </div>

        <div className="command-stream">
          {!submitted && recentIncidents.length === 0 && !incidentsLoading && (
            <div className="card card-padded">
              <div className="empty-state" style={{ padding: "48px 24px" }}>
                <div className="empty-state-icon">
                  <Icon name="inbox" size={28} />
                </div>
                <h3>No incidents indexed yet</h3>
                <p>Upload incident reports first so search can return evidence, similar incidents, and fix sections.</p>
                <Link className="btn btn-primary" to="/upload">
                  <Icon name="upload" size={16} />
                  Upload first incident
                </Link>
              </div>
            </div>
          )}

          {!submitted && recentIncidents.length > 0 && (
            <div className="command-empty-stack">
              <div className="card card-padded">
                <div className="panel-heading">
                  <h2>Results</h2>
                  <span className="badge">No search yet</span>
                </div>
                <div className="empty-state command-empty-state">
                  <div className="empty-state-icon">
                    <Icon name="pulse" size={28} />
                  </div>
                  <h3>Search the archive</h3>
                  <p>Results will show the best matching incident, related incidents, and evidence from the original sections.</p>
                </div>
              </div>

              <div className="card card-padded">
                <div className="panel-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2>Recent incidents</h2>
                  <Link to="/search" className="btn btn-secondary" style={{ padding: "4px 8px", fontSize: "0.75rem" }}>View all</Link>
                </div>
                <div className="timeline-stream">
                  {recentIncidents.map((incident) => (
                    <Link
                      key={incident.id}
                      to={`/incidents/${incident.id}`}
                      className="timeline-entry"
                    >
                      <div className={`timeline-entry-dot ${getSeverityClass(incident.severity)}`} />
                      <div className="timeline-entry-body">
                        <div className="timeline-entry-header">
                          <div className="incident-title">{incident.title}</div>
                          {incident.severity && <span className="badge">{incident.severity}</span>}
                        </div>
                        <div className="incident-meta">
                          {incident.company && <span>{incident.company}</span>}
                          {incident.date && <span>{formatDate(incident.date)}</span>}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          {submitted && searchQuery.isLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[1, 2, 3].map((item) => (
                <div key={item} className="skeleton" style={{ height: item === 1 ? 180 : 132, borderRadius: 16 }} />
              ))}
            </div>
          )}

          {submitted && searchQuery.error instanceof Error && (
            <div className="alert alert-error">
              <Icon name="alert" size={18} />
              <div>
                <strong>Search failed.</strong> {searchQuery.error.message}
              </div>
            </div>
          )}

          {submitted && !searchQuery.isLoading && !searchQuery.error && searchResults.length === 0 && (
            <div className="card card-padded">
              <div className="empty-state command-empty-state">
                <div className="empty-state-icon">
                  <Icon name="search" size={28} />
                </div>
                <h3>No matching incidents</h3>
                <p>Broaden the query, clear one filter, or search with the visible symptom instead of the suspected internal cause.</p>
              </div>
            </div>
          )}

          {submitted && searchResults.length > 0 && topResult && (
            <>
              <div className="card card-padded command-critical-card">
                <div className="panel-heading">
                  <h2>Best match</h2>
                  <span className="badge badge-brand">{formatMatchPercent(topResult.score)}% match</span>
                </div>

                <div className="command-hero">
                  <div>
                    <div className="incident-title" style={{ fontSize: "1.05rem" }}>
                      {topResult.incident.title}
                    </div>
                    <div className="incident-meta" style={{ marginTop: 6 }}>
                      {topResult.incident.company && <span>{topResult.incident.company}</span>}
                      {topResult.incident.date && <span>{formatDate(topResult.incident.date)}</span>}
                      {topResult.incident.severity && (
                        <span className="badge badge-warning">{topResult.incident.severity}</span>
                      )}
                    </div>
                  </div>
                  <Link className="btn btn-secondary" to={`/incidents/${topResult.incident.id}`}>
                    <Icon name="arrowRight" size={16} />
                    Open detail
                  </Link>
                </div>

                <p className="command-summary">
                  {rootCauseSnippet
                    ? truncateText(rootCauseSnippet, 260)
                    : "Search matched this incident most strongly, but it did not surface a root-cause section yet."}
                </p>
              </div>

              <div className="command-secondary-grid">
                <div className="card card-padded">
                  <div className="panel-heading">
                    <h2>Suggested fix</h2>
                    {qaQuery.isFetching && <span className="badge">Loading</span>}
                  </div>

                  <ul className="command-bullet-list">
                    {quickFixBullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>

                  {qaQuery.data?.status === "answered" && qaQuery.data.answer && (
                    <p className="command-subnote">
                      {stripCitationLabels(qaQuery.data.answer)}
                    </p>
                  )}

                  {qaQuery.error instanceof Error && (
                    <p className="command-subnote">
                      Q&amp;A fallback in use: {qaQuery.error.message}
                    </p>
                  )}
                </div>

                <div className="card card-padded">
                  <div className="panel-heading">
                    <h2>Fix section</h2>
                    <button className="btn btn-secondary" type="button" onClick={handleCopySnippet} disabled={!runbookSection?.text}>
                      <Icon name="fileText" size={16} />
                      {copiedSnippet ? "Copied" : "Copy snippet"}
                    </button>
                  </div>

                  {runbookSection ? (
                    <>
                      <div className="incident-meta" style={{ marginBottom: 10 }}>
                        <span className="badge">{runbookSection.type}</span>
                        <span>{detailQuery.data?.title ?? topResult.incident.title}</span>
                      </div>
                      <pre className="command-code-block">{runbookSection.text}</pre>
                    </>
                  ) : (
                    <p className="command-subnote">No fix section is available on the best match yet.</p>
                  )}
                </div>
              </div>

              <div className="card card-padded">
                <div className="panel-heading">
                  <h2>Similar incidents</h2>
                  <span className="badge">{similarQuery.data?.length ?? 0} related incidents</span>
                </div>

                {similarQuery.isLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {[1, 2, 3].map((item) => (
                      <div key={item} className="skeleton" style={{ height: 84, borderRadius: 12 }} />
                    ))}
                  </div>
                ) : similarQuery.error instanceof Error ? (
                  <p className="command-subnote">Similar incident lookup failed: {similarQuery.error.message}</p>
                ) : (similarQuery.data?.length ?? 0) > 0 ? (
                  <div className="timeline-accordion-list">
                    {(similarQuery.data ?? []).slice(0, 3).map((incident) => (
                      <SimilarIncidentAccordion key={incident.incident.id} incident={incident} />
                    ))}
                  </div>
                ) : (
                  <p className="command-subnote">No similar incidents were returned for this match.</p>
                )}
              </div>

              <div className="card card-padded">
                <div className="panel-heading">
                  <h2>Matching evidence</h2>
                  <span className="badge badge-brand">{searchResults.length} retrieved matches</span>
                </div>
                <EvidenceTimeline results={searchResults} />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
