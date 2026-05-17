import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { postQa, type QaResponse, type QaCitation } from "../lib/api";

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

const SECTION_COLORS: Record<string, string> = {
  impact: "var(--danger)",
  timeline: "var(--info)",
  rootcause: "var(--warning)",
  fix: "var(--success)",
};

function CitationCard({ citation }: { citation: QaCitation }) {
  return (
    <Link
      to={`/incidents/${citation.incidentId}${citation.anchor}`}
      className="search-result card"
      style={{ textDecoration: "none" }}
    >
      <div className="search-result-header">
        <div style={{ minWidth: 0 }}>
          <div className="incident-title">
            <span className="badge" style={{ marginRight: 8 }}>{citation.label}</span>
            {citation.title}
          </div>
          <div className="incident-meta">
            {citation.company && <span>{citation.company}</span>}
            {citation.date && <span>{formatDate(citation.date)}</span>}
          </div>
        </div>
        <div className="search-score-stack">
          <span className="badge badge-brand">
            {formatPercent(citation.retrievalScore)}% match
          </span>
        </div>
      </div>

      <div className="evidence-list">
        <div className="evidence-item">
          <div className="evidence-header">
            <span
              className="badge"
              style={{
                borderColor: SECTION_COLORS[citation.sectionType] ?? "var(--border)",
                color: SECTION_COLORS[citation.sectionType] ?? "var(--text-secondary)",
              }}
            >
              {citation.sectionType}
            </span>
          </div>
          <p>{citation.excerpt}</p>
        </div>
      </div>
    </Link>
  );
}

export default function Qa() {
  const [question, setQuestion] = useState("");
  const [company, setCompany] = useState("");
  const [tags, setTags] = useState("");

  const { data, isPending, error, mutate } = useMutation({
    mutationFn: postQa,
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;

    mutate({
      question: question.trim(),
      filters: {
        company: company.trim() || undefined,
        tags: tags.trim() ? tags.split(",").map(t => t.trim()) : undefined,
      },
      options: {
        maxEvidenceSections: 8,
        includeGraphContext: true,
        mode: "answer",
      }
    });
  }

  function handleClear() {
    setQuestion("");
    setCompany("");
    setTags("");
  }

  return (
    <section className="fade-in">
      <div className="page-header">
        <div>
          <h1>Q&A</h1>
          <p>Ask natural language questions backed by incident citations.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="search-form-panel">
        <div className="search-bar" style={{ marginBottom: 0 }}>
          <span className="search-icon">Q</span>
          <input
            id="qa-question"
            type="text"
            placeholder="What fixed the payment-api outage?"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            aria-label="Ask a question"
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
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="Tags (comma separated)"
            aria-label="Filter by tags"
            style={{ gridColumn: "span 2" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!question.trim() || isPending}
              style={{ flex: 1 }}
            >
              {isPending ? "Generating..." : "Ask"}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={handleClear}
              style={{ flexShrink: 0 }}
            >
              Clear
            </button>
          </div>
        </div>
      </form>

      {!data && !isPending && !error && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">Q</div>
            <h3>Ask the incident memory</h3>
            <p>Generated answers are strictly backed by incident evidence.</p>
          </div>
        </div>
      )}

      {isPending && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="skeleton" style={{ height: 80, borderRadius: 16 }} />
          <div className="skeleton" style={{ height: 160, borderRadius: 16 }} />
        </div>
      )}

      {error instanceof Error && (
        <div className="alert alert-error">
          <span>⚠️</span>
          <div>
            <strong>Generation failed.</strong> {error.message}
          </div>
        </div>
      )}

      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {data.status === "refused" && data.refusal ? (
            <div className="alert alert-warning">
              <span>⚠️</span>
              <div>
                <strong>Refused: {data.refusal.reasonCode}</strong>
                <p>{data.refusal.message}</p>
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: 24, fontSize: "1.05rem", lineHeight: 1.6 }}>
              {data.answer}
              <div style={{ marginTop: 16, fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", gap: 12 }}>
                <span>Model: {data.model.name}</span>
                <span>Prompt: {data.promptVersion}</span>
                <span>Audit: {data.auditId.slice(0, 8)}...</span>
              </div>
            </div>
          )}

          {data.citations && data.citations.length > 0 && (
            <div>
              <h3 style={{ fontSize: "1rem", marginBottom: 12, color: "var(--text-secondary)" }}>
                Citations ({data.evidenceCount} evidence sections retrieved)
              </h3>
              <div className="search-results-list">
                {data.citations.map((citation) => (
                  <CitationCard key={`${citation.incidentId}-${citation.sectionId}`} citation={citation} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
