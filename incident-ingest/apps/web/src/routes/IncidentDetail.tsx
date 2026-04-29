import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  getIncident,
  getSimilarIncidents,
  type IncidentDetail as IncidentDetailType,
  type SimilarIncidentResult,
} from "../lib/api";

const SECTION_ORDER = ["impact", "timeline", "rootcause", "fix"] as const;

const SECTION_META: Record<
  string,
  { label: string; icon: string; cls: string; color: string }
> = {
  impact: {
    label: "Impact",
    icon: "IM",
    cls: "impact",
    color: "var(--danger)",
  },
  timeline: {
    label: "Timeline",
    icon: "TL",
    cls: "timeline",
    color: "var(--info)",
  },
  rootcause: {
    label: "Root Cause",
    icon: "RC",
    cls: "rootcause",
    color: "var(--warning)",
  },
  fix: {
    label: "Mitigation / Fix",
    icon: "FX",
    cls: "fix",
    color: "var(--success)",
  },
};

function formatDate(date: string | null) {
  if (!date) return null;
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  return value.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function sortSections(sections: IncidentDetailType["sections"]) {
  return [...sections].sort(
    (left, right) =>
      SECTION_ORDER.indexOf(left.type as (typeof SECTION_ORDER)[number]) -
      SECTION_ORDER.indexOf(right.type as (typeof SECTION_ORDER)[number])
  );
}

function SectionPanel({ section }: { section: IncidentDetailType["sections"][0] }) {
  const meta = SECTION_META[section.type] ?? {
    label: section.type,
    icon: "TX",
    cls: "impact",
    color: "var(--text-secondary)",
  };

  return (
    <div className="section-panel" id={`section-${section.type}-${section.id}`}>
      <div className="section-header">
        <div className={`section-type-icon ${meta.cls}`}>{meta.icon}</div>
        <div>
          <div className="section-type-label" style={{ color: meta.color }}>
            {meta.label}
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <span className="badge" style={{ fontSize: "0.625rem", cursor: "default" }}>
            {section.id.slice(0, 8)}...
          </span>
        </div>
      </div>
      <div className="section-body">{section.text}</div>
    </div>
  );
}

function SimilarIncidentCard({ item }: { item: SimilarIncidentResult }) {
  const incident = item.incident;

  return (
    <Link to={`/incidents/${incident.id}`} className="similar-item">
      <div className="similar-item-header">
        <div className="incident-title" style={{ fontSize: "0.875rem" }}>
          {incident.title}
        </div>
        <span className="badge badge-brand">{Math.round(item.score * 100)}%</span>
      </div>
      <div className="incident-meta">
        {incident.company && <span>{incident.company}</span>}
        {incident.severity && <span className="badge badge-warning">{incident.severity}</span>}
      </div>
      <p className="similar-reason">{item.reason}</p>
      {item.matchedSections?.[0] && (
        <div className="similar-evidence">
          <span
            className="badge"
            style={{
              borderColor:
                SECTION_META[item.matchedSections[0].type]?.color ?? "var(--border)",
              color:
                SECTION_META[item.matchedSections[0].type]?.color ?? "var(--text-secondary)",
            }}
          >
            {item.matchedSections[0].type}
          </span>
          <p>{item.matchedSections[0].text}</p>
        </div>
      )}
    </Link>
  );
}

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["incident", id],
    queryFn: () => getIncident(id!),
    enabled: Boolean(id),
  });

  const {
    data: similar = [],
    isLoading: similarLoading,
    error: similarError,
  } = useQuery({
    queryKey: ["incident", id, "similar"],
    queryFn: () => getSimilarIncidents(id!),
    enabled: Boolean(id && data),
    retry: false,
  });

  if (!id) {
    return (
      <div className="card card-padded">
        <p>Missing incident ID.</p>
        <Link className="btn btn-secondary" to="/incidents" style={{ marginTop: 12 }}>
          Back to incidents
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="skeleton" style={{ height: 140, borderRadius: 16 }} />
        <div className="skeleton" style={{ height: 100, borderRadius: 14 }} />
        <div className="skeleton" style={{ height: 100, borderRadius: 14 }} />
        <div className="skeleton" style={{ height: 100, borderRadius: 14 }} />
      </div>
    );
  }

  if (error instanceof Error) {
    return (
      <div className="card card-padded fade-in">
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <span>!</span>
          <div>
            <strong>Incident not found.</strong> {error.message}
          </div>
        </div>
        <Link className="btn btn-secondary" to="/incidents">
          Back to incidents
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const date = formatDate(data.date);
  const sections = sortSections(data.sections ?? []);

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 14 }}>
        <Link
          to="/incidents"
          className="btn btn-secondary"
          id="back-to-incidents"
          style={{ fontSize: "0.8125rem", padding: "6px 14px" }}
        >
          Back to incidents
        </Link>
      </div>

      <div className="split-layout">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="detail-hero">
              <h1 style={{ fontSize: "1.375rem" }} id="incident-title">
                {data.title}
              </h1>
              <div className="detail-meta-row">
                {data.company && <span className="badge">{data.company}</span>}
                {date && <span className="badge">{date}</span>}
                {data.severity && <span className="badge badge-warning">{data.severity}</span>}
                {data.tags?.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {data.summaryText && (
              <div
                style={{
                  padding: "16px 28px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: "0.9375rem",
                  color: "var(--text-secondary)",
                  lineHeight: 1.7,
                  background: "rgba(8,11,18,0.3)",
                }}
                id="incident-summary"
              >
                <div
                  style={{
                    fontSize: "0.6875rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                    marginBottom: 8,
                  }}
                >
                  Summary
                </div>
                {data.summaryText}
              </div>
            )}

            <div
              style={{
                padding: "12px 28px",
                display: "flex",
                gap: 14,
                flexWrap: "wrap",
                fontSize: "0.75rem",
                color: "var(--text-muted)",
              }}
            >
              <span>
                <code className="inline-code">{data.id}</code>
              </span>
              <span>
                {sections.length} section{sections.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {sections.length === 0 ? (
            <div className="card">
              <div className="empty-state" style={{ padding: "36px 0" }}>
                <div className="empty-state-icon">TX</div>
                <h3>No sections extracted</h3>
                <p>This incident does not have structured section content yet.</p>
              </div>
            </div>
          ) : (
            <div id="incident-sections">
              {sections.map((section) => (
                <SectionPanel key={section.id} section={section} />
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card card-padded" id="similar-panel">
            <h2 style={{ fontSize: "0.9375rem", marginBottom: 10 }}>Similar Incidents</h2>

            {similarLoading && (
              <div className="similar-list">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="skeleton" style={{ height: 96, borderRadius: 12 }} />
                ))}
              </div>
            )}

            {similarError instanceof Error && (
              <div className="alert alert-error">
                <span>!</span>
                <div>{similarError.message}</div>
              </div>
            )}

            {!similarLoading && !(similarError instanceof Error) && similar.length === 0 && (
              <div className="empty-state" style={{ padding: "24px 0" }}>
                <div className="empty-state-icon">~</div>
                <h3>No close matches yet</h3>
                <p>Add more incidents to widen retrieval coverage.</p>
              </div>
            )}

            {similar.length > 0 && (
              <div className="similar-list">
                {similar.map((item) => (
                  <SimilarIncidentCard key={item.incident.id} item={item} />
                ))}
              </div>
            )}
          </div>

          {sections.length > 0 && (
            <div className="card card-padded" id="section-index">
              <h2 style={{ fontSize: "0.9375rem", marginBottom: 10 }}>Section Index</h2>
              {sections.map((section) => {
                const meta = SECTION_META[section.type] ?? {
                  label: section.type,
                  icon: "TX",
                };

                return (
                  <a
                    key={section.id}
                    href={`#section-${section.type}-${section.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 0",
                      borderBottom: "1px solid var(--border)",
                      fontSize: "0.8125rem",
                      color: "var(--text-secondary)",
                      textDecoration: "none",
                    }}
                  >
                    <span>{meta.icon}</span>
                    <span>{meta.label}</span>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: "0.6875rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      {section.text.split(" ").length} words
                    </span>
                  </a>
                );
              })}
            </div>
          )}

          <div className="card card-padded" style={{ opacity: 0.6 }}>
            <h2 style={{ fontSize: "0.9375rem", marginBottom: 6 }}>Knowledge Graph</h2>
            <p style={{ fontSize: "0.8125rem" }}>Graph exploration lands in Sprint 3.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
