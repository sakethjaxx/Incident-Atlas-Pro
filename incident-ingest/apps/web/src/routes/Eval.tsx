import { useQuery } from "@tanstack/react-query";
import { getEvalLatest } from "../lib/api";
import Icon from "../components/Icon";

function formatPercent(value: number | null | undefined) {
  if (value == null) return "N/A";
  return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`;
}

function formatDate(date: string | null) {
  if (!date) return null;
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  return value.toLocaleString("en-US");
}

export default function Eval() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["eval-latest"],
    queryFn: getEvalLatest,
    retry: false,
  });

  return (
    <section className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-title">
            <h1>Quality</h1>
            <p>Latest retrieval and answer quality report.</p>
          </div>
          <div className="page-header-actions">
            <button className="btn btn-secondary" type="button" onClick={() => refetch()} disabled={isFetching}>
              <Icon name="refresh" size={16} />
              {isFetching ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="skeleton" style={{ height: 120, borderRadius: 16 }} />
          <div className="skeleton" style={{ height: 300, borderRadius: 16 }} />
        </div>
      )}

      {error instanceof Error && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name="alert" size={28} />
            </div>
            <h3>Evaluation report unavailable</h3>
            <p>{error.message}</p>
          </div>
        </div>
      )}

      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 18, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ fontSize: "1.2rem", marginBottom: 4 }}>
                  Run ID: <span style={{ fontFamily: "monospace", fontSize: "1rem" }}>{data.runId}</span>
                </h2>
                <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <span>
                    Status:{" "}
                    <strong
                      style={{
                        color:
                          data.status === "passed"
                            ? "var(--success)"
                            : data.status === "failed"
                              ? "var(--danger)"
                              : "var(--warning)",
                      }}
                    >
                      {data.status.toUpperCase()}
                    </strong>
                  </span>
                  <span>Mode: {data.mode}</span>
                  <span>Query Set: {data.querySetVersion}</span>
                  {data.gitSha && <span>Commit: {data.gitSha.slice(0, 7)}</span>}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: 4 }}>
                  Finished: {formatDate(data.finishedAt)}
                </div>
              </div>
            </div>

            <div className="eval-overview-grid">
              <div>
                <h3 style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase" }}>Metrics</h3>
                <div style={{ display: "grid", gap: 8 }}>
                  {Object.entries(data.metrics).map(([key, value]) => {
                    const threshold = data.thresholds?.[key];
                    let isPassing = true;
                    if (threshold !== undefined && value != null) {
                      isPassing = value >= threshold;
                    }
                    if (key.toLowerCase().includes("drop") || key.toLowerCase().includes("misscount") || key.toLowerCase().includes("rate")) {
                      if (threshold !== undefined && value != null) {
                        isPassing = value <= threshold;
                      }
                    }

                    return (
                      <div key={key} style={{ display: "flex", justifyContent: "space-between", paddingBottom: 8, borderBottom: "1px solid var(--border)", gap: 10 }}>
                        <span style={{ fontSize: "0.9rem" }}>{key}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {threshold !== undefined && (
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                              tgt: {key.includes("Count") ? threshold : formatPercent(threshold)}
                            </span>
                          )}
                          <strong style={{ color: isPassing ? "inherit" : "var(--danger)" }}>
                            {value === null ? "N/A" : key.includes("Count") ? value : formatPercent(value)}
                          </strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase" }}>Configuration</h3>
                <div style={{ fontSize: "0.85rem", lineHeight: 1.6, color: "var(--text-secondary)" }}>
                  <div><strong>Models:</strong> {data.models?.map((model) => model.model).join(", ")}</div>
                  <div><strong>Prompt Version:</strong> {data.promptVersion}</div>
                  <div><strong>Search Limit:</strong> {data.retrievalConfig?.searchLimit}</div>
                  <div><strong>Evidence Limit:</strong> {data.retrievalConfig?.evidenceSectionLimit}</div>
                  <div><strong>Embedding:</strong> {data.retrievalConfig?.embeddingModel}</div>
                  <div><strong>Graph Depth:</strong> {data.graphConfig?.maxDepth}</div>
                </div>

                {data.failures && data.failures.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    <h3 style={{ fontSize: "0.9rem", color: "var(--danger)", marginBottom: 12, textTransform: "uppercase" }}>
                      Failures ({data.failures.length})
                    </h3>
                    <div style={{ maxHeight: 200, overflowY: "auto", fontSize: "0.85rem", color: "var(--text-secondary)", padding: 12, background: "rgba(0,0,0,0.2)", borderRadius: 8 }}>
                      {data.failures.map((failure, index) => (
                        <div key={index} style={{ marginBottom: 8 }}>
                          <strong>{failure.queryId || "Unknown"}:</strong> {failure.reason || JSON.stringify(failure)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
