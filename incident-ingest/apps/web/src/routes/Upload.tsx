import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { uploadFile, getJobStatus, type JobStatus } from "../lib/api";

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      setFile(selected);
      setError(null);
      setJobId(null);
      setJobStatus(null);
    }
  };

  const clearFile = () => {
    setFile(null);
    setJobId(null);
    setJobStatus(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;

    setError(null);
    setJobStatus(null);

    try {
      const res = await uploadFile(file);
      setJobId(res.jobId);
    } catch (err: any) {
      setError(err.message || "Upload failed");
    }
  };

  // Polling effect
  useEffect(() => {
    if (!jobId) return;

    let timeoutId: number;
    let isCancelled = false;

    const poll = async () => {
      try {
        const state = await getJobStatus(jobId);
        if (isCancelled) return;

        setJobStatus(state);

        if (state.status === "completed") {
          // If the job succeeded and we got the incident ID, we could navigate
          // or just show the success banner. We'll wait 1.5s then navigate to it.
          const incidentId = state.result?.incidentId;
          if (incidentId) {
            setTimeout(() => {
              if (!isCancelled) navigate(`/incidents/${incidentId}`);
            }, 1000);
          }
          return; // done polling
        }

        if (state.status === "failed") {
          setError(state.error || state.result?.error || "Job failed during processing.");
          return; // done polling
        }

        // continue polling
        timeoutId = window.setTimeout(poll, 1000);
      } catch (err: any) {
        if (!isCancelled) {
          setError(`Failed to poll job status: ${err.message}`);
        }
      }
    };

    poll();

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [jobId, navigate]);

  const isWorking =
    jobId !== null &&
    jobStatus?.status !== "completed" &&
    jobStatus?.status !== "failed" &&
    !error;

  return (
    <section className="fade-in">
      <div className="page-header">
        <h1>Upload Incident</h1>
        <p>
          Upload an incident report (txt, md) — the pipeline will asynchronously
          extract Impact, Timeline, Root Cause, and Fix sections.
        </p>
      </div>

      {/* Success / Redirect banner */}
      {jobStatus?.status === "completed" && (
        <div className="alert alert-success" id="upload-success" style={{ marginBottom: 18 }}>
          <span>✅</span>
          <div>
            <strong>Processing complete!</strong>{" "}
            {jobStatus.result?.incidentId ? (
              <Link to={`/incidents/${jobStatus.result.incidentId}`} style={{ color: "inherit", fontWeight: 700, textDecoration: "underline" }}>
                Redirecting to incident...
              </Link>
            ) : (
              "Incident created."
            )}
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="alert alert-error" id="upload-error" style={{ marginBottom: 18 }}>
          <span>⚠️</span>
          <div>
            <strong>Upload failed.</strong> {error}
          </div>
        </div>
      )}

      <div className="split-layout">
        {/* Form */}
        <div className="card card-padded">
          <h2 style={{ fontSize: "0.9375rem", marginBottom: 20 }}>Select File</h2>

          <form
            id="upload-form"
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 18 }}
          >
            <div className="form-group">
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "40px 20px",
                  border: "2px dashed var(--border)",
                  borderRadius: "var(--r-lg)",
                  background: "var(--bg-overlay)",
                  cursor: isWorking ? "not-allowed" : "pointer",
                  transition: "border-color 0.2s, background 0.2s",
                }}
                className={isWorking ? "disabled" : ""}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!isWorking) e.currentTarget.style.borderColor = "var(--brand)";
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  if (!isWorking) e.currentTarget.style.borderColor = "var(--border)";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!isWorking) {
                    e.currentTarget.style.borderColor = "var(--border)";
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      setFile(e.dataTransfer.files[0]);
                      setError(null);
                      setJobId(null);
                      setJobStatus(null);
                    }
                  }
                }}
              >
                <div style={{ fontSize: "2rem", marginBottom: 12 }}>📄</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {file ? file.name : "Click or drag a file to upload"}
                </div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                  {file
                    ? `${(file.size / 1024).toFixed(1)} KB`
                    : "Supports .txt and .md files up to 10MB"}
                </div>
                <input
                  type="file"
                  id="file-upload"
                  accept=".txt,.md,text/plain,text/markdown"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                  ref={fileInputRef}
                  disabled={isWorking}
                />
              </label>
            </div>

            {/* Polling / Job Status Indicator */}
            {jobId && !error && jobStatus?.status !== "completed" && (
              <div
                style={{
                  padding: 16,
                  borderRadius: "var(--r-md)",
                  background: "var(--bg-overlay)",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: "0.8125rem" }}>
                  <strong style={{ color: "var(--brand)" }}>
                    {jobStatus?.status === "waiting" && "Waiting in queue..."}
                    {jobStatus?.status === "active" && "Extracting sections..."}
                    {(!jobStatus || !jobStatus.status) && "Initializing..."}
                  </strong>
                  <span style={{ color: "var(--text-muted)" }}>
                    {jobStatus?.progress ?? 0}%
                  </span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${jobStatus?.progress ?? 0}%`,
                      background: "linear-gradient(90deg, var(--brand-from), var(--brand-to))",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                type="submit"
                id="submit-btn"
                className="btn btn-primary"
                disabled={!file || isWorking}
              >
                {isWorking ? (
                  <>
                    <div className="spinner" />
                    Uploading...
                  </>
                ) : (
                  "⊕ Upload & Parse"
                )}
              </button>

              {file && !isWorking && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={clearFile}
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
            <div style={{ marginTop: 12 }}>
              <input
                disabled
                className="form-input"
                placeholder="https://github.com/org/repo/issues/123"
                style={{ opacity: 0.5, cursor: "not-allowed" }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
