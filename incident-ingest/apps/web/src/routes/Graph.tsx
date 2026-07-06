import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGraphPatterns, getGraphNeighbors, type GraphNode, type GraphPattern, getMetadataNodes } from "../lib/api";
import Icon from "../components/Icon";
import ForceGraph2D from "react-force-graph-2d";

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
        background: selected ? `color-mix(in srgb, ${nodeColor(node.type)} 12%, transparent)` : undefined,
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
        <Icon name="alert" size={18} />
        <div>{error.message}</div>
      </div>
    );
  }

  if (!data || data.edges.length === 0) {
    return (
      <p style={{ padding: "10px 0", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
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
          const fromNode = data.nodes.find((node) => node.id === edge.from);
          const toNode = data.nodes.find((node) => node.id === edge.to);
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
                  color: "var(--text-secondary)",
                  fontFamily: "monospace",
                }}
                title="evidence section id"
              >
                evidence {edge.evidence_section_id.slice(0, 8)}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 20, height: 400, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <ForceGraph2D
          width={600}
          height={400}
          graphData={{
            nodes: data.nodes.map(n => ({ id: n.id, name: n.name, type: n.type, color: nodeColor(n.type) })),
            links: data.edges.map(e => ({ source: e.from, target: e.to, type: e.type }))
          }}
          nodeLabel="name"
          nodeColor="color"
          linkDirectionalArrowLength={3.5}
          linkDirectionalArrowRelPos={1}
          linkColor={() => "var(--border)"}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const label = node.name as string;
            const fontSize = 12 / globalScale;
            ctx.font = `${fontSize}px Sans-Serif`;
            const textWidth = ctx.measureText(label).width;
            const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2); // some padding

            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillRect(
              (node.x || 0) - bckgDimensions[0] / 2, 
              (node.y || 0) - bckgDimensions[1] / 2, 
              bckgDimensions[0], 
              bckgDimensions[1]
            );

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = node.color as string;
            ctx.fillText(label, node.x || 0, node.y || 0);

            node.__bckgDimensions = bckgDimensions; // to re-use in nodePointerAreaPaint
          }}
        />
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
  const expanded = pattern.nodes.some((node) => node.id === selectedNodeId);

  return (
    <div className="card card-padded" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <span className="badge badge-brand">
          {pattern.incidentCount} incident{pattern.incidentCount !== 1 ? "s" : ""}
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
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
  const [submitted, setSubmitted] = useState<{ service: string; symptom: string } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const hasQuery = submitted !== null && (submitted.service.length > 0 || submitted.symptom.length > 0);

  const { data: servicesData } = useQuery({ queryKey: ["metadata-nodes", "service"], queryFn: () => getMetadataNodes("service"), retry: false });
  const { data: symptomsData } = useQuery({ queryKey: ["metadata-nodes", "symptom"], queryFn: () => getMetadataNodes("symptom"), retry: false });

  const servicesList = servicesData ?? [];
  const symptomsList = symptomsData ?? [];

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
    setSelectedNodeId((previous) => (previous === id ? null : id));
  }

  return (
    <section className="fade-in">
      <div className="page-header">
        <div className="page-header-title">
          <h1>Patterns</h1>
          <p>Find recurring services, symptoms, root causes, and fixes across incidents.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="search-form-panel">
        <div className="search-form-grid graph-filter-grid">
          <div className="field-stack">
            <label htmlFor="graph-service">Service</label>
            <input
              id="graph-service"
              className="form-input"
              value={service}
              onChange={(event) => setService(event.target.value)}
              placeholder="payment-api"
              aria-label="Filter by service"
              list="graph-services-list"
            />
            <datalist id="graph-services-list">
              {servicesList.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div className="field-stack">
            <label htmlFor="graph-symptom">Symptom</label>
            <input
              id="graph-symptom"
              className="form-input"
              value={symptom}
              onChange={(event) => setSymptom(event.target.value)}
              placeholder="high error rate"
              aria-label="Filter by symptom"
              list="graph-symptoms-list"
            />
            <datalist id="graph-symptoms-list">
              {symptomsList.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div className="field-stack">
            <label htmlFor="graph-submit">Run</label>
            <button
              id="graph-submit"
              className="btn btn-primary"
              type="submit"
              disabled={!service.trim() && !symptom.trim()}
            >
              <Icon name="graph" size={16} />
              {isFetching ? "Searching..." : "Find patterns"}
            </button>
          </div>
        </div>
      </form>

      {!hasQuery && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name="graph" size={28} />
            </div>
            <h3>Explore the knowledge graph</h3>
            <p>Filter by service or symptom to find repeated incident patterns.</p>
          </div>
        </div>
      )}

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map((item) => (
            <div key={item} className="skeleton" style={{ height: 80, borderRadius: 14 }} />
          ))}
        </div>
      )}

      {error instanceof Error && (
        <div className="alert alert-error">
          <Icon name="alert" size={18} />
          <div>
            <strong>Query failed.</strong> {error.message}
          </div>
        </div>
      )}

      {!isLoading && !error && hasQuery && patterns.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name="inbox" size={28} />
            </div>
            <h3>No patterns found</h3>
            <p>Try a different service name, a broader symptom, or ingest more incident material first.</p>
          </div>
        </div>
      )}

      {patterns.length > 0 && (
        <div>
          <div className="search-summary-line">
            {patterns.length} pattern{patterns.length !== 1 ? "s" : ""} | click a node to inspect its neighbors
          </div>
          {patterns.map((pattern, index) => (
            <PatternCard
              key={index}
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
