import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getIncidents, type Incident } from "../lib/api";

function formatDate(date: string | null) {
  if (!date) return "Date TBD";
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "Date TBD";
  return value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function IncidentCard({ incident }: { incident: Incident }) {
  return (
    <Link className="card" to={`/incidents/${incident.id}`}>
      <h2>{incident.title}</h2>
      <p>{incident.company || "Company TBD"}</p>
      <span className="badge">{formatDate(incident.date)}</span>
      {incident.summaryText ? <p>{incident.summaryText}</p> : null}
    </Link>
  );
}

export default function Incidents() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["incidents"],
    queryFn: getIncidents,
  });

  return (
    <section>
      <h1>Incidents</h1>
      <p>Browse ingested incidents and drill into their sections.</p>

      {isLoading ? (
        <div className="card">
          <p>Loading incidents...</p>
        </div>
      ) : null}

      {error instanceof Error ? (
        <div className="alert error">{error.message}</div>
      ) : null}

      {!isLoading && (!data || data.length === 0) ? (
        <div className="card">
          <h2>No incidents yet</h2>
          <p>Use the manual ingest endpoint to create the first one.</p>
        </div>
      ) : null}

      {data && data.length > 0 ? (
        <div className="list">
          {data.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
