import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getGraphPatterns,
  getGraphNeighbors,
  type GraphNode,
  type GraphPattern,
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

function NodeBadge({
  node,
  onClick,
  selected,
}: {
  node: GraphNode;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="badge"
      style={{
        borderColor: nodeColor(node.type),
        color: nodeColor(node.type),
        cursor: onClick ? "pointer" : "default",
        background: selected
          ? `color-mix(in srgb, ${nodeColor(node.type)} 12%, transparent)`
          : undefined,
        fontFamily: "inherit",
        fontSize: "0.75rem",
      }}
      title={node.type}
    >
      {node.name}
    </button>
  );
}

function NeighborsPanel({ nodeId }: { nodeId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["graph", "neighbors", nodeId],
    queryFn: () => getGraphNeighbors(nodeId, 1),
    retry: false,
  });

  if (isLoading) {
    return <div className="skeleton" style={{ height: 72, borderRadius: 10, marginTop: 8 }} />;
  }

  if (error instanceof Error) {
    return (
      <div className="alert alert-error" style={{ marginTop: 8 }}>
        <span>!</span>
        <div>{error.message}</div>
      </div>
    );
  }

  if (!data || data.edges.length === 0) {
    return (
      <p style={{ padding: "10px 0", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
        No edges found for this node.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontSize: "0.6875rem",
          fontWeight: 700,
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 6,
        }}
      >
        Neighbors (depth 1)
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {data.edges.map((edge) => {
          const fromNode = data.nodes.find((n) => n.id === edge.from);
          const toNode = data.nodes.find((n) => n.id === edge.to);
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
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "0.6875rem",
                  color: "var(--text-muted)",
                  fontFamily: "monospace",
                }}
                title="evidence section id"
              >
                §{edge.evidence_section_id.slice(0, 8)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PatternCard({
  pattern,
  onSelectNode,
  selectedNodeId,
}: {
  pattern: GraphPattern;
  onSelectNode: (id: string) => void;
  selectedNodeId: string | null;
}) {
  const expanded = pattern.nodes.some((n) => n.id === selectedNodeId);

  return (
    <div className="card card-padded" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span className="badge badge-brand">
          {pattern.incidentCount} incident{pattern.incidentCount !== 1 ? "s" : ""}
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {pattern.nodes.length} node{pattern.nodes.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {pattern.nodes.map((node) => (
          <NodeBadge
            key={node.id}
            node={node}
            onClick={() => onSelectNode(node.id)}
            selected={selectedNodeId === node.id}
          />
        ))}
      </div>
      {expanded && <NeighborsPanel nodeId={selectedNodeId!} />}
    </div>
  );
}

export default function Graph() {
  const [service, setService] = useState("");
  const [symptom, setSymptom] = useState("");
  const [submitted, setSubmitted] = useState<{
    service: string;
    symptom: string;
  } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const hasQuery =
    submitted !== null &&
    (submitted.service.length > 0 || submitted.symptom.length > 0);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["graph", "patterns", submitted],
    queryFn: () =>
      getGraphPatterns({
        service: submitted!.service || undefined,
        symptom: submitted!.symptom || undefined,
      }),
    enabled: hasQuery,
    retry: false,
  });

  const patterns = data?.patterns ?? [];

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSelectedNodeId(null);
    setSubmitted({ service: service.trim(), symptom: symptom.trim() });
  }

  function handleSelectNode(id: string) {
    setSelectedNodeId((prev) => (prev === id ? null : id));
  }

  return (
    <section className="fade-in">
      <div className="page-header">
        <div>
          <h1>Knowledge Graph</h1>
          <p>Browse recurring failure patterns extracted from incident sections.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="search-form-panel">
        <div
          className="search-form-grid"
          style={{ gridTemplateColumns: "1fr 1fr auto" }}
        >
          <input
            className="form-input"
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="Service name (e.g. payment-api)"
            aria-label="Filter by service"
          />
          <input
            className="form-input"
            value={symptom}
            onChange={(e) => setSymptom(e.target.value)}
            placeholder="Symptom (e.g. high error rate)"
            aria-label="Filter by symptom"
          />
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!service.trim() && !symptom.trim()}
          >
            {isFetching ? "Searching..." : "Find Patterns"}
          </button>
        </div>
      </form>

      {!hasQuery && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">@</div>
            <h3>Explore the knowledge graph</h3>
            <p>Filter by service or symptom to find recurring failure patterns.</p>
          </div>
        </div>
      )}

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map((n) => (
            <div key={n} className="skeleton" style={{ height: 80, borderRadius: 14 }} />
          ))}
        </div>
      )}

      {error instanceof Error && (
        <div className="alert alert-error">
          <span>!</span>
          <div>
            <strong>Query failed.</strong> {error.message}
          </div>
        </div>
      )}

      {!isLoading && !error && hasQuery && patterns.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">0</div>
            <h3>No patterns found</h3>
            <p>Try a different service or symptom name.</p>
          </div>
        </div>
      )}

      {patterns.length > 0 && (
        <div>
          <div className="search-summary-line">
            {patterns.length} pattern{patterns.length !== 1 ? "s" : ""} ·{" "}
            click a node to inspect its neighbors
          </div>
          {patterns.map((pattern, idx) => (
            <PatternCard
              key={idx}
              pattern={pattern}
              onSelectNode={handleSelectNode}
              selectedNodeId={selectedNodeId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
