import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getIncidents, type Incident } from "../lib/api";

function getSeverityClass(severity: string | null) {
  if (!severity) return "sev-unknown";
  const s = severity.toLowerCase();
  if (s.includes("1") || s.includes("critical")) return "sev-1";
  if (s.includes("2") || s.includes("high")) return "sev-2";
  if (s.includes("3") || s.includes("med")) return "sev-3";
  return "sev-4";
}

export default function Dashboard() {
  const { data = [], isLoading } = useQuery<Incident[]>({
    queryKey: ["incidents"],
    queryFn: getIncidents,
  });

  const total = data.length;
  const withSections = data.filter((i) => i.summaryText).length;
  const companies = new Set(data.map((i) => i.company).filter(Boolean)).size;
  const recent = [...data]
    .filter((i) => i.date)
    .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())
    .slice(0, 5);

  return (
    <section className="fade-in">
      <div className="page-header">
        <h1>Incident Intelligence Dashboard</h1>
        <p>Overview of ingested incidents, section coverage, and quick access to all major features.</p>
      </div>

      {/* Stat ribbon */}
      <div className="stats-grid">
        {[
          {
            label: "Total Incidents",
            value: isLoading ? "—" : total,
            sub: "ingested documents",
            icon: "📋",
          },
          {
            label: "With Summaries",
            value: isLoading ? "—" : withSections,
            sub: `${total ? Math.round((withSections / total) * 100) : 0}% coverage`,
            icon: "📝",
          },
          {
            label: "Companies",
            value: isLoading ? "—" : companies,
            sub: "unique sources",
            icon: "🏢",
          },
          {
            label: "Sprint",
            value: "1",
            sub: "Foundations · Week 1",
            icon: "🚀",
          },
        ].map((stat) => (
          <div key={stat.label} className="card stat-card glow-card">
            <div className="stat-label">
              <span>{stat.icon}</span>
              {stat.label}
            </div>
            <div className="stat-value">{stat.value}</div>
            <div className="stat-sub">{stat.sub}</div>
          </div>
        ))}
      </div>

      <div className="split-layout">
        {/* Recent incidents */}
        <div>
          <div
            className="card card-padded"
            style={{ marginBottom: 0 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <h2 style={{ fontSize: "0.9375rem" }}>Recent Incidents</h2>
              <Link className="btn btn-secondary" id="view-all-btn" to="/incidents" style={{ fontSize: "0.75rem", padding: "5px 12px" }}>
                View all →
              </Link>
            </div>

            {isLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[1, 2, 3].map((n) => (
                  <div key={n} className="skeleton" style={{ height: 58 }} />
                ))}
              </div>
            ) : recent.length === 0 ? (
              <div className="empty-state" style={{ padding: "40px 0" }}>
                <div className="empty-state-icon">🗂</div>
                <h3>No incidents yet</h3>
                <p>Use Manual Upload to ingest your first incident report.</p>
                <Link className="btn btn-primary" to="/upload" style={{ marginTop: 8 }}>
                  Upload an incident
                </Link>
              </div>
            ) : (
              <div className="incident-list">
                {recent.map((incident) => (
                  <Link
                    key={incident.id}
                    to={`/incidents/${incident.id}`}
                    className="incident-row card"
                    style={{ textDecoration: "none" }}
                    id={`incident-row-${incident.id}`}
                  >
                    <div
                      className={`incident-sev-dot ${getSeverityClass(incident.severity)}`}
                      title={incident.severity || "Unknown severity"}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="incident-title">{incident.title}</div>
                      <div className="incident-meta">
                        {incident.company && <span>{incident.company}</span>}
                        {incident.date && (
                          <span>
                            {new Date(incident.date).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        )}
                        {incident.severity && (
                          <span className="badge badge-warning" style={{ fontSize: "0.625rem" }}>
                            {incident.severity}
                          </span>
                        )}
                      </div>
                    </div>
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>→</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Quick links */}
          <div className="card card-padded">
            <h2 style={{ fontSize: "0.9375rem", marginBottom: 14 }}>Quick Actions</h2>
            <div className="quick-links">
              <Link className="quick-link" to="/upload" id="quick-upload-link">
                <span className="quick-link-icon">⊕</span>
                Upload Report
              </Link>
              <Link className="quick-link" to="/incidents" id="quick-incidents-link">
                <span className="quick-link-icon">📋</span>
                Browse All
              </Link>
              <div className="quick-link" style={{ opacity: 0.35, cursor: "not-allowed" }} title="Coming in Sprint 2">
                <span className="quick-link-icon">🔍</span>
                Search
              </div>
              <div className="quick-link" style={{ opacity: 0.35, cursor: "not-allowed" }} title="Coming in Sprint 3">
                <span className="quick-link-icon">🕸</span>
                Graph
              </div>
            </div>
          </div>

          {/* Sprint progress */}
          <div className="card card-padded">
            <h2 style={{ fontSize: "0.9375rem", marginBottom: 14 }}>Sprint Progress</h2>
            {[
              { label: "Schema + Migrations", pct: 100, done: true },
              { label: "Manual Ingest API", pct: 100, done: true },
              { label: "Section Splitting", pct: 100, done: true },
              { label: "Incident UI", pct: 80, done: false },
              { label: "Embeddings + Vector", pct: 0, done: false },
              { label: "Hybrid Search", pct: 0, done: false },
            ].map((item) => (
              <div key={item.label} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.75rem",
                    marginBottom: 4,
                    color: item.done ? "var(--success)" : "var(--text-secondary)",
                    fontWeight: item.done ? 600 : 400,
                  }}
                >
                  <span>{item.done ? "✓ " : ""}{item.label}</span>
                  <span style={{ color: "var(--text-muted)" }}>{item.pct}%</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${item.pct}%`,
                      background: item.done
                        ? "linear-gradient(90deg, var(--success), #22c55e)"
                        : undefined,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Definition of Done */}
          <div className="card card-padded">
            <h2 style={{ fontSize: "0.9375rem", marginBottom: 12 }}>MVP Definition of Done</h2>
            {[
              { label: "≥30–50 incidents in DB", done: total >= 30 },
              { label: "Search with evidence sections", done: false },
              { label: "Similar incidents panel", done: false },
              { label: "Graph explorer", done: false },
              { label: "Eval harness in CI", done: false },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "0.8125rem",
                  color: item.done ? "var(--success)" : "var(--text-muted)",
                  padding: "5px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ fontSize: 12 }}>{item.done ? "✅" : "○"}</span>
                {item.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
