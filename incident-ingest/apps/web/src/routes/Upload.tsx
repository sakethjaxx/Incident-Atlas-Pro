import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  createManualIncident,
  type IncidentDetail,
  type ManualIngestPayload,
} from "../lib/api";

const EXAMPLE_TEXT = `Impact:
Checkout flow was completely unavailable for all users in the EU region for 34 minutes. Approximately 12,000 transactions failed.

Timeline:
13:04 UTC — First alert fired on elevated 5xx rate from the payment service.
13:08 UTC — On-call engineer acknowledged and started investigation.
13:19 UTC — Root cause identified as exhausted DB connection pool.
13:38 UTC — Connection pool limit raised and deploy rolled out. Traffic normalized.

Root Cause:
A misconfigured Helm chart bumped the replica count of the payment service to 40 without proportionally increasing the PostgreSQL max_connections limit. Each pod held 5 connections, exhausting the pool at peak load.

Fix:
Increased max_connections from 200 to 400. Added HPA max replica guard and a Terraform policy to gate connection pool changes. Post-incident review scheduled for next Monday.`;

export default function Upload() {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [date, setDate] = useState("");
  const [rawText, setRawText] = useState("");
  const [success, setSuccess] = useState<IncidentDetail | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const mutation = useMutation({
    mutationFn: (payload: ManualIngestPayload) => createManualIncident(payload),
    onSuccess: (data) => {
      setSuccess(data);
      setTitle("");
      setCompany("");
      setDate("");
      setRawText("");
    },
  });

  const canSubmit = useMemo(
    () => title.trim().length > 0 && rawText.trim().length > 0,
    [title, rawText]
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSuccess(null);

    const isoDate = date ? new Date(date).toISOString() : undefined;
    const payload: ManualIngestPayload = {
      title: title.trim(),
      rawText: rawText.trim(),
    };

    if (company.trim()) payload.company = company.trim();
    if (isoDate) payload.date = isoDate;

    mutation.mutate(payload);
  };

  const loadExample = () => {
    setTitle("Payments checkout outage — EU region");
    setCompany("ExampleCo");
    setDate("2024-11-15");
    setRawText(EXAMPLE_TEXT);
    setSuccess(null);
    mutation.reset();
  };

  return (
    <section className="fade-in">
      <div className="page-header">
        <h1>Manual Upload</h1>
        <p>
          Submit a raw incident report — the API will auto-split it into Impact,
          Timeline, Root Cause, and Fix sections.
        </p>
      </div>

      {/* Success banner */}
      {success && (
        <div className="alert alert-success" id="upload-success" style={{ marginBottom: 18 }}>
          <span>✅</span>
          <div>
            <strong>Incident created.</strong>{" "}
            <Link to={`/incidents/${success.id}`} style={{ color: "inherit", fontWeight: 700, textDecoration: "underline" }}>
              View "{success.title}"
            </Link>
            {" "}— {success.sections?.length ?? 0} section{success.sections?.length !== 1 ? "s" : ""} extracted.
          </div>
        </div>
      )}

      {/* Error banner */}
      {mutation.error instanceof Error && (
        <div className="alert alert-error" id="upload-error" style={{ marginBottom: 18 }}>
          <span>⚠️</span>
          <div>
            <strong>Upload failed.</strong> {mutation.error.message}
          </div>
        </div>
      )}

      <div className="split-layout">
        {/* Form */}
        <div className="card card-padded">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <h2 style={{ fontSize: "0.9375rem" }}>Incident Details</h2>
            <button
              type="button"
              className="btn btn-secondary"
              id="load-example-btn"
              onClick={loadExample}
              style={{ fontSize: "0.75rem", padding: "5px 12px" }}
            >
              Load example
            </button>
          </div>

          <form
            ref={formRef}
            id="upload-form"
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 18 }}
          >
            <div className="form-group">
              <label className="form-label" htmlFor="title">
                Title <span>*</span>
              </label>
              <input
                id="title"
                className="form-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder='e.g. "Payments checkout outage — EU region"'
                required
                aria-required="true"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="company">
                  Company
                </label>
                <input
                  id="company"
                  className="form-input"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="ExampleCo"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="date">
                  Incident Date
                </label>
                <input
                  id="date"
                  type="date"
                  className="form-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="rawText">
                Raw Incident Text <span>*</span>
              </label>
              <p
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  marginBottom: 6,
                }}
              >
                Use headings like{" "}
                <code className="inline-code">Impact:</code>,{" "}
                <code className="inline-code">Timeline:</code>,{" "}
                <code className="inline-code">Root Cause:</code>,{" "}
                <code className="inline-code">Fix:</code> to auto-split
                sections.
              </p>
              <textarea
                id="rawText"
                className="form-input form-textarea"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Impact:&#10;Describe the customer impact here...&#10;&#10;Timeline:&#10;13:00 — Event A&#10;13:15 — Event B&#10;&#10;Root Cause:&#10;Describe the root cause...&#10;&#10;Fix:&#10;Describe the resolution..."
                required
                aria-required="true"
                rows={12}
              />
              {rawText.trim().length > 0 && (
                <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: 4 }}>
                  {rawText.trim().split(/\s+/).length} words · {rawText.length} chars
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                type="submit"
                id="submit-btn"
                className="btn btn-primary"
                disabled={!canSubmit || mutation.isPending}
              >
                {mutation.isPending ? (
                  <>
                    <div className="spinner" />
                    Processing…
                  </>
                ) : (
                  "⊕ Create Incident"
                )}
              </button>

              {(title || rawText) && !mutation.isPending && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setTitle("");
                    setCompany("");
                    setDate("");
                    setRawText("");
                    setSuccess(null);
                    mutation.reset();
                  }}
                  style={{ fontSize: "0.8125rem" }}
                >
                  Clear
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Right panel — tips */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card card-padded">
            <h2 style={{ fontSize: "0.9375rem", marginBottom: 14 }}>
              📋 Section Format Guide
            </h2>
            {[
              {
                label: "Impact",
                color: "var(--danger)",
                desc: "Customer-visible effects, error rates, duration, scope",
              },
              {
                label: "Timeline",
                color: "var(--info)",
                desc: "Chronological events — detection → response → resolution",
              },
              {
                label: "Root Cause",
                color: "var(--warning)",
                desc: "Technical cause chain — what failed and why",
              },
              {
                label: "Fix",
                color: "var(--success)",
                desc: "Mitigations, hotfixes, and follow-up preventions",
              },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    width: 4,
                    borderRadius: 2,
                    background: item.color,
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: "0.8125rem",
                      color: item.color,
                      marginBottom: 2,
                    }}
                  >
                    {item.label}:
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {item.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card card-padded" style={{ opacity: 0.65 }}>
            <h2 style={{ fontSize: "0.9375rem", marginBottom: 8 }}>
              🌐 URL Crawl
            </h2>
            <p style={{ fontSize: "0.8125rem" }}>
              Automatic crawl from status pages and GitHub issues — coming in
              Sprint 2.
            </p>
            <div
              style={{ marginTop: 12 }}
            >
              <input
                disabled
                className="form-input"
                placeholder="https://github.com/org/repo/issues/123"
                style={{ opacity: 0.5, cursor: "not-allowed" }}
              />
            </div>
          </div>

          <div className="card card-padded">
            <h2 style={{ fontSize: "0.9375rem", marginBottom: 10 }}>
              🔗 API Endpoint
            </h2>
            <code
              style={{
                display: "block",
                background: "var(--bg-base)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-md)",
                padding: "10px 12px",
                fontSize: "0.75rem",
                color: "var(--brand)",
                lineHeight: 1.7,
              }}
            >
              POST /ingest/manual<br />
              {`{`}<br />
              {"  "}title: string *<br />
              {"  "}rawText: string *<br />
              {"  "}company?: string<br />
              {"  "}date?: ISO-8601<br />
              {`}`}
            </code>
          </div>
        </div>
      </div>
    </section>
  );
}
