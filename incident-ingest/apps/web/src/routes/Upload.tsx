import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { uploadFiles, getJobStatus, type JobStatus, getMetadataCompanies } from "../lib/api";
import Icon from "../components/Icon";

const MAX_FILES_PER_BATCH = 20;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

interface UploadJob {
  fileName: string;
  jobId: string;
  documentId: string;
  status: JobStatus | null;
  error: string | null;
}

function isTerminalStatus(status?: JobStatus["status"]) {
  return status === "completed" || status === "failed";
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function statusLabel(job: UploadJob) {
  if (job.error) return "Failed";
  if (!job.status) return "Queued";
  if (job.status.status === "waiting") return "Waiting";
  if (job.status.status === "active") return "Processing";
  if (job.status.status === "completed") return "Complete";
  if (job.status.status === "failed") return "Failed";
  return job.status.status;
}

export default function Upload() {
  const [files, setFiles] = useState<File[]>([]);
  const [company, setCompany] = useState("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getMetadataCompanies().then(setCompanies).catch(console.error);
  }, []);

  const totalSelectedSize = files.reduce((sum, file) => sum + file.size, 0);
  const completedCount = uploadJobs.filter((job) => job.status?.status === "completed").length;
  const failedCount = uploadJobs.filter((job) => job.error || job.status?.status === "failed").length;

  const activeJobIds = useMemo(
    () =>
      uploadJobs
        .filter((job) => !job.error && !isTerminalStatus(job.status?.status))
        .map((job) => job.jobId)
        .join(","),
    [uploadJobs]
  );
  const hasActiveJobs = activeJobIds.length > 0;

  const selectFiles = (fileList: FileList | null) => {
    const nextFiles = Array.from(fileList ?? []);
    if (nextFiles.length === 0) return;

    setFiles((prevFiles) => {
      // Deduplicate by name + size
      const existingKeys = new Set(prevFiles.map((f) => `${f.name}-${f.size}`));
      const newFiles = nextFiles.filter((f) => !existingKeys.has(`${f.name}-${f.size}`));
      const combined = [...prevFiles, ...newFiles];

      if (combined.length > MAX_FILES_PER_BATCH) {
        setError(`Select up to ${MAX_FILES_PER_BATCH} files per batch. You selected ${combined.length}.`);
        return prevFiles;
      }

      const tooLarge = combined.find((file) => file.size > MAX_FILE_SIZE_BYTES);
      if (tooLarge) {
        setError(`${tooLarge.name} exceeds the 10MB per-file limit.`);
        return prevFiles;
      }

      setError(null);
      setUploadJobs([]);
      return combined;
    });
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    selectFiles(event.target.files);
    // Reset so the same file can be selected again if removed
    event.target.value = "";
  };

  const clearFiles = () => {
    setFiles([]);
    setCompany("");
    setUploadJobs([]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (files.length === 0) return;
    if (!company.trim()) {
      setError("Company is required before upload.");
      return;
    }

    setError(null);
    setUploadJobs([]);

    try {
      const response = await uploadFiles(files, { company: company.trim() });
      const uploads =
        response.uploads ??
        (response.jobId && response.documentId
          ? [
              {
                fileName: response.fileName ?? files[0]?.name ?? "Uploaded file",
                jobId: response.jobId,
                documentId: response.documentId,
                bullmqJobId: response.bullmqJobId,
                pollUrl: response.pollUrl ?? `/jobs/${response.jobId}`,
              },
            ]
          : []);

      if (uploads.length === 0) {
        throw new Error("Upload response did not include any jobs.");
      }

      setUploadJobs(
        uploads.map((upload, index) => ({
          fileName: upload.fileName || files[index]?.name || `File ${index + 1}`,
          jobId: upload.jobId,
          documentId: upload.documentId,
          status: null,
          error: null,
        }))
      );
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (nextError: any) {
      setError(nextError.message || "Upload failed");
    }
  };

  useEffect(() => {
    if (!activeJobIds) return;

    let timeoutId: number | undefined;
    let isCancelled = false;
    const jobIds = activeJobIds.split(",");

    const poll = async () => {
      type PollResult = { jobId: string; status: JobStatus } | { jobId: string; error: string };

      const results: PollResult[] = await Promise.all(
        jobIds.map(async (jobId) => {
          try {
            return { jobId, status: await getJobStatus(jobId) };
          } catch (pollError: any) {
            return {
              jobId,
              error: pollError.message || "Failed to poll job status.",
            };
          }
        })
      );

      if (isCancelled) return;

      setUploadJobs((currentJobs) =>
        currentJobs.map((job) => {
          const result = results.find((item) => item.jobId === job.jobId);
          if (!result) return job;
          if ("error" in result) {
            return { ...job, error: result.error };
          }

          const state = result.status;
          return {
            ...job,
            status: state,
            error:
              state.status === "failed"
                ? state.error || state.result?.error || "Job failed during processing."
                : job.error,
          };
        })
      );

      const stillActive = results.some(
        (result) => !("error" in result) && !isTerminalStatus(result.status.status)
      );
      if (stillActive) {
        timeoutId = window.setTimeout(poll, 1000);
      }
    };

    poll();

    return () => {
      isCancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [activeJobIds]);

  return (
    <section className="fade-in">
      <div className="page-header">
        <div className="page-header-title">
          <h1>Upload</h1>
          <p>Add incident reports to the archive. Each file is parsed as a separate incident.</p>
        </div>
      </div>

      {uploadJobs.length > 0 && completedCount > 0 && (
        <div className="alert alert-success" id="upload-success" role="status" style={{ marginBottom: 18 }}>
          <Icon name="checkCircle" size={18} />
          <div>
            <strong>{completedCount} incident{completedCount === 1 ? "" : "s"} processed.</strong>{" "}
            {failedCount > 0 ? `${failedCount} failed.` : "Ready to review."}
          </div>
        </div>
      )}

      {error && (
        <div className="alert alert-error" id="upload-error" style={{ marginBottom: 18 }}>
          <Icon name="alert" size={18} />
          <div>
            <strong>Upload failed.</strong> {error}
          </div>
        </div>
      )}

      <div className="split-layout">
        <div className="card card-padded">
          <div className="panel-heading">
            <h2>Select files</h2>
          </div>

          <form id="upload-form" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="upload-company">
                Company <span>*</span>
              </label>
              <input
                id="upload-company"
                className="form-input"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="Acme"
                disabled={hasActiveJobs}
                required
                list="company-list"
              />
              <datalist id="company-list">
                {companies.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <p className="form-help">This becomes the document scope used by Search and Q&amp;A.</p>
            </div>

            <div className="form-group">
              <label
                className={`upload-dropzone ${isDragging ? "is-dragging" : ""}`}
                role="button"
                tabIndex={hasActiveJobs ? -1 : 0}
                aria-disabled={hasActiveJobs}
                aria-label="Select incident report files"
                onKeyDown={(event) => {
                  if ((event.key === "Enter" || event.key === " ") && !hasActiveJobs) {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!hasActiveJobs) setIsDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!hasActiveJobs) setIsDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  if (!hasActiveJobs) setIsDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!hasActiveJobs) {
                    setIsDragging(false);
                    selectFiles(event.dataTransfer.files);
                  }
                }}
                style={{
                  cursor: hasActiveJobs ? "not-allowed" : "pointer",
                  opacity: hasActiveJobs ? 0.72 : 1,
                  borderColor: isDragging ? "var(--brand)" : "var(--border)",
                  backgroundColor: isDragging ? "var(--bg-overlay)" : "transparent",
                  transition: "border-color 0.2s, background-color 0.2s",
                }}
              >
                <div className="upload-dropzone-icon" style={{ color: isDragging ? "var(--brand)" : "inherit" }}>
                  <Icon name="upload" size={24} />
                </div>
                <div className="upload-dropzone-title">
                  {files.length === 1
                    ? files[0].name
                    : files.length > 1
                      ? `${files.length} files selected`
                      : "Select incident reports"}
                </div>
                <div style={{ fontWeight: 600, marginBottom: 6, textAlign: "center", color: "var(--text-primary)" }}>
                  {files.length > 0 ? `${formatSize(totalSelectedSize)} total` : "Click or drag files here"}
                </div>
                <div className="upload-dropzone-copy">
                  {files.length > 0
                    ? "Ready to queue for parsing."
                    : `Supports .txt and .md files. Up to ${MAX_FILES_PER_BATCH} files, 10MB each.`}
                </div>
                <input
                  type="file"
                  id="file-upload"
                  accept=".txt,.md,text/plain,text/markdown"
                  multiple
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                  ref={fileInputRef}
                  disabled={hasActiveJobs}
                />
              </label>

              {files.length > 0 && !hasActiveJobs && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                  {files.map((f, i) => (
                    <div
                      key={`${f.name}-${f.size}-${f.lastModified}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        background: "var(--bg-overlay)",
                        borderRadius: "var(--r-sm)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.8125rem",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {f.name} ({formatSize(f.size)})
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: 4 }}
                        onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                        title={`Remove ${f.name}`}
                        aria-label={`Remove ${f.name}`}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {uploadJobs.length > 0 && (
              <div
                style={{
                  padding: 16,
                  borderRadius: "var(--r-md)",
                  background: "var(--bg-overlay)",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: "0.8125rem", gap: 10, flexWrap: "wrap" }}>
                  <strong style={{ color: "var(--brand)" }}>
                    {completedCount} of {uploadJobs.length} complete
                  </strong>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {failedCount > 0 ? `${failedCount} failed` : hasActiveJobs ? "Processing" : "Done"}
                  </span>
                </div>
                <div
                  className="progress-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={uploadJobs.length}
                  aria-valuenow={completedCount}
                  aria-label={`${completedCount} of ${uploadJobs.length} files processed`}
                  style={{ marginBottom: 12 }}
                >
                  <div
                    className="progress-fill"
                    style={{
                      width: `${(completedCount / uploadJobs.length) * 100}%`,
                      background: "var(--brand)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {uploadJobs.map((job) => {
                    const incidentId = job.status?.result?.incidentId;
                    return (
                      <div
                        key={job.jobId}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: 12,
                          alignItems: "center",
                          paddingTop: 10,
                          borderTop: "1px solid var(--border)",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 650, fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {job.fileName}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                            {job.error || `Progress ${job.status?.progress ?? 0}%`}
                          </div>
                        </div>
                        {job.status?.status === "completed" && incidentId ? (
                          <Link
                            to={`/incidents/${incidentId}`}
                            className="btn btn-secondary"
                            style={{ fontSize: "0.75rem", padding: "6px 10px" }}
                          >
                            Open
                          </Link>
                        ) : (
                          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                            {statusLabel(job)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="submit"
                id="submit-btn"
                className="btn btn-primary"
                disabled={files.length === 0 || !company.trim() || hasActiveJobs}
              >
                {hasActiveJobs ? (
                  <>
                    <div className="spinner" />
                    Processing...
                  </>
                ) : files.length > 1 ? (
                  <>
                    <Icon name="upload" size={16} />
                    {`Queue ${files.length} Files`}
                  </>
                ) : (
                  <>
                    <Icon name="upload" size={16} />
                    Upload
                  </>
                )}
              </button>

              {(files.length > 0 || uploadJobs.length > 0) && !hasActiveJobs && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={clearFiles}
                  style={{ fontSize: "0.8125rem" }}
                >
                  Clear
                </button>
              )}
            </div>
          </form>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card card-padded">
            <div className="panel-heading">
              <h2>Recommended sections</h2>
            </div>
            {[
              {
                label: "Impact",
                color: "var(--danger)",
                desc: "Customer-visible effects, error rates, duration, and scope.",
              },
              {
                label: "Timeline",
                color: "var(--info)",
                desc: "Chronological events from detection through mitigation and resolution.",
              },
              {
                label: "Root Cause",
                color: "var(--warning)",
                desc: "The technical cause chain and the conditions that made it possible.",
              },
              {
                label: "Fix",
                color: "var(--success)",
                desc: "Mitigations, hotfixes, and the follow-up actions that prevent a repeat.",
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
                    {item.label}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    {item.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card card-padded" style={{ opacity: 0.75 }}>
            <div className="panel-heading">
              <h2>URL import</h2>
            </div>
            <p style={{ fontSize: "0.8125rem" }}>
              Import from status pages and GitHub issues is planned.
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
