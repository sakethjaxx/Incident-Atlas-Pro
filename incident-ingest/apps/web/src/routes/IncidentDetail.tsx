import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getIncident, type IncidentDetail as IncidentDetailType } from "../lib/api";

const SECTION_ORDER = ["impact", "timeline", "rootcause", "fix"] as const;

const SECTION_META: Record<
  string,
  { label: string; icon: string; cls: string; color: string }
> = {
  impact: {
    label: "Impact",
    icon: "⚡",
    cls: "impact",
    color: "var(--danger)",
  },
  timeline: {
    label: "Timeline",
    icon: "🕐",
    cls: "timeline",
    color: "var(--info)",
  },
  rootcause: {
    label: "Root Cause",
    icon: "🔍",
    cls: "rootcause",
    color: "var(--warning)",
  },
  fix: {
    label: "Mitigation / Fix",
    icon: "✅",
    cls: "fix",
    color: "var(--success)",
  },
};

function formatDate(date: string | null) {
  if (!date) return null;
  const v = new Date(date);
  if (Number.isNaN(v.getTime())) return null;
  return v.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function sortSections(sections: IncidentDetailType["sections"]) {
  return [...sections].sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.type as typeof SECTION_ORDER[number]) -
      SECTION_ORDER.indexOf(b.type as typeof SECTION_ORDER[number])
  );
}

function SectionPanel({ section }: { section: IncidentDetailType["sections"][0] }) {
  const meta = SECTION_META[section.type] ?? {
    label: section.type,
    icon: "📄",
    cls: "impact",
    color: "var(--text-secondary)",
  };

  return (
    <div
      className="section-panel"
      id={`section-${section.type}-${section.id}`}
    >
      <div className="section-header">
        <div className={`section-type-icon ${meta.cls}`}>{meta.icon}</div>
        <div>
          <div className="section-type-label" style={{ color: meta.color }}>
            {meta.label}
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <span
            className="badge"
            style={{ fontSize: "0.625rem", cursor: "default" }}
            title="Section ID — evidence pointer"
          >
            {section.id.slice(0, 8)}…
          </span>
        </div>
      </div>
      <div className="section-body">{section.text}</div>
    </div>
  );
}

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["incident", id],
    queryFn: () => getIncident(id!),
    enabled: Boolean(id),
  });

  if (!id) {
    return (
      <div className="card card-padded">
        <p>Missing incident ID.</p>
        <Link className="btn btn-secondary" to="/incidents" style={{ marginTop: 12 }}>
          ← Back to incidents
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
          <span>⚠️</span>
          <div>
            <strong>Incident not found.</strong> {error.message}
          </div>
        </div>
        <Link className="btn btn-secondary" to="/incidents">
          ← Back to incidents
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const date = formatDate(data.date);
  const sections = sortSections(data.sections ?? []);

  return (
    <div className="fade-in">
      {/* Back link */}
      <div style={{ marginBottom: 14 }}>
        <Link
          to="/incidents"
          className="btn btn-secondary"
          id="back-to-incidents"
          style={{ fontSize: "0.8125rem", padding: "6px 14px" }}
        >
          ← Incidents
        </Link>
      </div>

      <div className="split-layout">
        {/* Left: main content */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Hero card */}
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="detail-hero">
              <h1 style={{ fontSize: "1.375rem" }} id="incident-title">
                {data.title}
              </h1>
              <div className="detail-meta-row">
                {data.company && (
                  <span className="badge">
                    🏢 {data.company}
                  </span>
                )}
                {date && (
                  <span className="badge">
                    📅 {date}
                  </span>
                )}
                {data.severity && (
                  <span className="badge badge-warning">
                    🔥 {data.severity}
                  </span>
                )}
                {data.tags && data.tags.length > 0 &&
                  data.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))
                }
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
                    letterSpacing: "0.08em",
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
              <span>{sections.length} section{sections.length !== 1 ? "s" : ""}</span>
            </div>
          </div>

          {/* Sections */}
          {sections.length === 0 ? (
            <div className="card">
              <div className="empty-state" style={{ padding: "36px 0" }}>
                <div className="empty-state-icon">📄</div>
                <h3>No sections extracted</h3>
                <p>
                  This incident has no structured sections. The raw text may
                  not contain labeled headings (Impact, Timeline, Root Cause,
                  Fix).
                </p>
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

        {/* Right: metadata sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Similar incidents placeholder */}
          <div className="card card-padded" id="similar-panel">
            <h2 style={{ fontSize: "0.9375rem", marginBottom: 4 }}>
              Similar Incidents
            </h2>
            <p style={{ fontSize: "0.8125rem", marginBottom: 14 }}>
              Vector similarity + reason matching — coming in Sprint 2.
            </p>
            <div
              style={{
                background: "var(--bg-overlay)",
                borderRadius: "var(--r-lg)",
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {[
                "Pattern analysis…",
                "Shared triggers…",
                "Similar fixes…",
              ].map((label) => (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    opacity: 0.4,
                  }}
                >
                  <div
                    className="skeleton"
                    style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      className="skeleton"
                      style={{ height: 10, marginBottom: 5, borderRadius: 4 }}
                    />
                    <div
                      className="skeleton"
                      style={{ height: 8, width: "60%", borderRadius: 4 }}
                    />
                  </div>
                </div>
              ))}
              <p
                style={{
                  fontSize: "0.6875rem",
                  color: "var(--text-muted)",
                  textAlign: "center",
                  marginTop: 4,
                }}
              >
                🔗 /incidents/{"{id}"}/similar
              </p>
            </div>
          </div>

          {/* Section index */}
          {sections.length > 0 && (
            <div className="card card-padded" id="section-index">
              <h2 style={{ fontSize: "0.9375rem", marginBottom: 10 }}>
                Section Index
              </h2>
              {sections.map((s) => {
                const meta = SECTION_META[s.type] ?? {
                  label: s.type,
                  icon: "📄",
                };
                return (
                  <a
                    key={s.id}
                    href={`#section-${s.type}-${s.id}`}
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
                      {s.text.split(" ").length} words
                    </span>
                  </a>
                );
              })}
            </div>
          )}

          {/* Knowledge graph placeholder */}
          <div className="card card-padded" style={{ opacity: 0.6 }}>
            <h2 style={{ fontSize: "0.9375rem", marginBottom: 6 }}>
              🕸 Knowledge Graph
            </h2>
            <p style={{ fontSize: "0.8125rem" }}>
              Entities, edges, and evidence pointers — coming in Sprint 3.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
