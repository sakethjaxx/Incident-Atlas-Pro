import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  getIncident,
  getSimilarIncidents,
  getGraphPatterns,
  getGraphNeighbors,
  type IncidentDetail as IncidentDetailType,
  type SimilarIncidentResult,
} from "../lib/api";

const NODE_TYPE_COLOR: Record<string, string> = {
  service: "var(--brand)",
  symptom: "var(--danger)",
  root_cause: "var(--warning)",
  fix: "var(--success)",
};

function nodeColor(type: string) {
  return NODE_TYPE_COLOR[type] ?? "var(--text-muted)";
}

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

function IncidentGraphPanel({ incident }: { incident: IncidentDetailType }) {
  const company = incident.company;

  const sectionMap = useMemo(
    () => new Map(incident.sections.map((s) => [s.id, s])),
    [incident.sections]
  );

  const { data: patternsData, isLoading: patternsLoading } = useQuery({
    queryKey: ["graph", "patterns", "detail", company],
    queryFn: () => getGraphPatterns({ service: company! }),
    enabled: Boolean(company),
    retry: false,
  });

  const anchorNode = patternsData?.patterns?.[0]?.nodes?.[0] ?? null;

  const { data: neighborsData, isLoading: neighborsLoading } = useQuery({
    queryKey: ["graph", "neighbors", anchorNode?.id],
    queryFn: () => getGraphNeighbors(anchorNode!.id, 1),
    enabled: Boolean(anchorNode),
    retry: false,
  });

  const isLoading = patternsLoading || neighborsLoading;
  const edges = neighborsData?.edges ?? [];
  const nodes = neighborsData?.nodes ?? [];

  return (
    <div className="card card-padded" id="graph-panel">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <h2 style={{ fontSize: "0.9375rem" }}>Knowledge Graph</h2>
        <Link
          to={
            company
              ? `/graph?service=${encodeURIComponent(company)}`
              : "/graph"
          }
          style={{ fontSize: "0.75rem", color: "var(--brand)" }}
        >
          Browse all →
        </Link>
      </div>

      {isLoading && (
        <div className="skeleton" style={{ height: 80, borderRadius: 10 }} />
      )}

      {!isLoading && edges.length === 0 && (
        <div className="empty-state" style={{ padding: "16px 0" }}>
          <div className="empty-state-icon">@</div>
          <p style={{ fontSize: "0.8125rem" }}>
            No graph data yet — nodes are extracted as incidents are processed.
          </p>
        </div>
      )}

      {edges.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {edges.map((edge) => {
            const fromNode = nodes.find((n) => n.id === edge.from);
            const toNode = nodes.find((n) => n.id === edge.to);
            const section = sectionMap.get(edge.evidence_section_id);
            return (
              <div
                key={edge.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 0",
                  borderBottom: "1px solid var(--border)",
                  fontSize: "0.8125rem",
                  flexWrap: "wrap",
                }}
              >
                {fromNode && (
                  <span style={{ color: nodeColor(fromNode.type), fontWeight: 500 }}>
                    {fromNode.name}
                  </span>
                )}
                <span style={{ color: "var(--text-muted)", fontSize: "0.6875rem" }}>
                  {edge.type}
                </span>
                {toNode && (
                  <span style={{ color: nodeColor(toNode.type), fontWeight: 500 }}>
                    {toNode.name}
                  </span>
                )}
                {section && (
                  <a
                    href={`#section-${section.type}-${section.id}`}
                    style={{
                      marginLeft: "auto",
                      fontSize: "0.6875rem",
                      color: "var(--brand)",
                    }}
                    title={`Evidence: ${section.type}`}
                  >
                    [{section.type}] ↑
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
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

          <IncidentGraphPanel incident={data} />
        </div>
      </div>
    </div>
  );
}
