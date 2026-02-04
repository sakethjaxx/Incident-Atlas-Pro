import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getIncident, type IncidentDetail } from "../lib/api";

const SECTION_ORDER = ["impact", "timeline", "rootcause", "fix"] as const;
const SECTION_LABELS: Record<string, string> = {
  impact: "Impact",
  timeline: "Timeline",
  rootcause: "Root Cause",
  fix: "Fix",
};

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

function sortSections(sections: IncidentDetail["sections"]) {
  return [...sections].sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.type) - SECTION_ORDER.indexOf(b.type)
  );
}

export default function IncidentDetail() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["incident", id],
    queryFn: () => getIncident(id || ""),
    enabled: Boolean(id),
  });

  if (!id) {
    return (
      <div className="card">
        <p>Missing incident id.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="card">
        <p>Loading incident...</p>
      </div>
    );
  }

  if (error instanceof Error) {
    return (
      <div className="card">
        <h2>Incident not found</h2>
        <p>{error.message}</p>
        <Link className="badge" to="/incidents">
          Back to incidents
        </Link>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const sections = sortSections(data.sections || []);

  return (
    <section>
      <h1>{data.title}</h1>
      <p>{data.company || "Company TBD"}</p>
      <div className="badge">{formatDate(data.date)}</div>

      {data.tags && data.tags.length > 0 ? (
        <div className="section">
          {data.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {data.summaryText ? (
        <div className="section">
          <h3>Summary</h3>
          <p>{data.summaryText}</p>
        </div>
      ) : null}

      {sections.map((section) => (
        <div key={section.id} className="section card">
          <h3>{SECTION_LABELS[section.type] || section.type}</h3>
          <p>{section.text}</p>
        </div>
      ))}
    </section>
  );
}
