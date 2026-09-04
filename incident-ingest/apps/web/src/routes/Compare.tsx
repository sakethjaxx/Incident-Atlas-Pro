import { useState, FormEvent, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import Icon from "../components/Icon";
import { request } from "../lib/api";

type ComparisonResponse = {
  comparison: {
    answer: string | null;
    comparisonTable: Array<{
      incidentId: string;
      title: string;
      company: string | null;
      date: string | null;
      impact: string | null;
      rootcause: string | null;
      fix: string | null;
    }>;
    hasComparison: boolean;
  };
  incidents: Array<{
    id: string;
    title: string;
    company: string | null;
    date: string | null;
  }>;
};

export default function Compare() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [incidentIds, setIncidentIds] = useState(searchParams.get("ids") ?? "");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("ids")) {
      handleCompare(searchParams.get("ids")!);
    }
  }, []);

  async function handleCompare(ids: string) {
    if (!ids) return;
    const idsArray = ids
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    
    if (idsArray.length < 2) {
      setError("Please provide at least 2 comma-separated Incident IDs");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await request<ComparisonResponse>("/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentIds: idsArray, question: "Compare these incidents" }),
      });
      setData(response);
    } catch (err: any) {
      setError(err.message || "Failed to compare incidents");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSearchParams({ ids: incidentIds });
    handleCompare(incidentIds);
  }

  return (
    <div className="layout-content">
      <header className="content-header">
        <h1>Incident Comparison</h1>
        <p className="subtitle">Compare impact, root cause, and fixes across multiple incidents.</p>
      </header>

      <form onSubmit={onSubmit} style={{ marginBottom: "2rem" }}>
        <div className="search-bar">
          <span className="search-icon">
            <Icon name="search" size={16} />
          </span>
          <input
            type="text"
            placeholder="Enter comma-separated incident IDs..."
            value={incidentIds}
            onChange={(e) => setIncidentIds(e.target.value)}
          />
        </div>
        <button type="submit" className="button button-primary" disabled={loading}>
          {loading ? "Comparing..." : "Compare"}
        </button>
      </form>

      {error && <div className="error-banner">{error}</div>}

      {data && data.comparison.hasComparison && (
        <div className="comparison-results">
          <div className="card" style={{ marginBottom: "2rem", padding: "1.5rem" }}>
            <h3>Synthesis</h3>
            <p style={{ lineHeight: 1.6 }}>{data.comparison.answer}</p>
          </div>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Impact</th>
                  <th>Root Cause</th>
                  <th>Fix</th>
                </tr>
              </thead>
              <tbody>
                {data.comparison.comparisonTable.map((row) => (
                  <tr key={row.incidentId}>
                    <td>
                      <strong>{row.title}</strong>
                      {row.company && <div><small>{row.company}</small></div>}
                    </td>
                    <td>{row.impact || "-"}</td>
                    <td>{row.rootcause || "-"}</td>
                    <td>{row.fix || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
