import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { postQa, type QaCitation, type ScopeSource } from "../lib/api";
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
            {citation.sourceAccess && <span className="badge badge-info">{citation.sourceAccess.label}</span>}
          </div>
        </div>
        <div className="search-score-stack">
          <span className="badge badge-brand">{formatPercent(citation.retrievalScore)}% match</span>
        </div>
      </div>

      {citation.sourceAccess && (
        <div className="source-access-line">
          <Icon name="checkCircle" size={14} />
          <span>{citation.sourceAccess.accessReason}</span>
        </div>
      )}

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
  const [scopeSource, setScopeSource] = useState<ScopeSource>("uploaded_documents");
  const [company, setCompany] = useState("");
  const [tags, setTags] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data, isPending, error, mutate } = useMutation({
    mutationFn: postQa,
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;

    mutate({
      question: question.trim(),
      scope: {
        source: scopeSource,
        companies: company.trim() ? [company.trim()] : undefined,
      },
      filters: {
        company: company.trim() || undefined,
        tags: tags.trim() ? tags.split(",").map((tag) => tag.trim()) : undefined,
        from: from.trim() || undefined,
        to: to.trim() || undefined,
      },
      options: {
        maxEvidenceSections: 8,
        includeGraphContext: true,
        mode: "answer",
      },
    });
  }

  function handleClear() {
    setQuestion("");
    setScopeSource("uploaded_documents");
    setCompany("");
    setTags("");
    setFrom("");
    setTo("");
  }

  return (
    <section className="fade-in">
      <div className="page-header">
        <div className="page-header-title">
          <h1>Ask</h1>
          <p>Ask a question about incident history and review the cited sources.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="search-form-panel">
        <div className="search-bar" style={{ marginBottom: 0 }}>
          <span className="search-icon">
            <Icon name="qa" size={16} />
          </span>
          <input
            id="qa-question"
            type="text"
            placeholder="What fixed the payment-api outage?"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            aria-label="Ask a question"
          />
        </div>

        <div className="scope-segmented" aria-label="Answer source">
          <button
            type="button"
            className={scopeSource === "uploaded_documents" ? "active" : ""}
            onClick={() => setScopeSource("uploaded_documents")}
          >
            <Icon name="inbox" size={15} />
            Uploaded documents
          </button>
          <button
            type="button"
            className={scopeSource === "public_web" ? "active" : ""}
            onClick={() => setScopeSource("public_web")}
          >
            <Icon name="search" size={15} />
            Public web
          </button>
        </div>

        <div className="search-form-grid">
          <div className="field-stack">
            <label htmlFor="qa-company">Company</label>
            <input
              id="qa-company"
              className="form-input"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              placeholder={scopeSource === "public_web" ? "Public company" : "Allowed company"}
              aria-label="Filter by company"
            />
          </div>
          <div className="field-stack field-span-2">
            <label htmlFor="qa-tags">Tags</label>
            <input
              id="qa-tags"
              className="form-input"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="payments, database, failover"
              aria-label="Filter by tags"
            />
          </div>
          <div className="field-stack">
            <label htmlFor="qa-from">From date</label>
            <input
              id="qa-from"
              type="date"
              className="form-input"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              aria-label="Filter from date"
            />
          </div>
          <div className="field-stack">
            <label htmlFor="qa-to">To date</label>
            <input
              id="qa-to"
              type="date"
              className="form-input"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              aria-label="Filter to date"
            />
          </div>
          <div className="field-stack">
            <label htmlFor="qa-actions">Run</label>
            <div id="qa-actions" style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={!question.trim() || isPending}
                style={{ flex: 1 }}
              >
                <Icon name="spark" size={16} />
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
        </div>
      </form>

      {!data && !isPending && !error && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name="qa" size={28} />
            </div>
            <h3>Ask the incident memory</h3>
            <p>Answers include citations from the incident archive.</p>
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
          <Icon name="alert" size={18} />
          <div>
            <strong>Generation failed.</strong> {error.message}
          </div>
        </div>
      )}

      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {data.status === "refused" && data.refusal ? (
            <div className="alert alert-warning">
              <Icon name="alert" size={18} />
              <div>
                <strong>Refused: {data.refusal.reasonCode}</strong>
                <p>{data.refusal.message}</p>
              </div>
            </div>
          ) : (
            <>
              {data.confidence !== undefined && data.confidence < 0.5 && (
                <div className="alert alert-warning" style={{ marginBottom: 8 }}>
                  <Icon name="alert" size={16} />
                  <span>Low confidence ({formatPercent(data.confidence)}%) - answer may be incomplete. Verify with original sources.</span>
                </div>
              )}
              <div className="card" style={{ padding: 24, fontSize: "1.05rem", lineHeight: 1.6 }}>
                {data.answer}
                <div style={{ marginTop: 16, fontSize: "0.8rem", color: "var(--text-secondary)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <span>Model: {data.model.name}</span>
                  <span>Prompt: {data.promptVersion}</span>
                  {data.scope && (
                    <span>{data.scope.source === "public_web" ? "Public web" : "Uploaded documents"}</span>
                  )}
                  {data.confidence !== undefined && (
                    <span
                      style={{
                        color: data.confidence >= 0.5 ? "var(--success)" : "var(--warning)",
                        fontWeight: 600,
                      }}
                    >
                      Confidence: {formatPercent(data.confidence)}%
                    </span>
                  )}
                  <span>Audit: {data.auditId.slice(0, 8)}...</span>
                </div>
              </div>
            </>
          )}

          {data.citations && data.citations.length > 0 && (
            <div>
              <h3 style={{ fontSize: "1rem", marginBottom: 12, color: "var(--text-secondary)" }}>
                Sources ({data.evidenceCount} evidence sections retrieved)
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
