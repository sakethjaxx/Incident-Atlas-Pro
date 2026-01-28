import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  createManualIncident,
  type IncidentDetail,
  type ManualIngestPayload,
} from "../lib/api";

export default function Upload() {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [date, setDate] = useState("");
  const [rawText, setRawText] = useState("");
  const [success, setSuccess] = useState<IncidentDetail | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: ManualIngestPayload) => createManualIncident(payload),
    onSuccess: (data) => {
      setSuccess(data);
      setRawText("");
      setTitle("");
      setCompany("");
      setDate("");
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

    if (company.trim()) {
      payload.company = company.trim();
    }
    if (isoDate) {
      payload.date = isoDate;
    }

    mutation.mutate(payload);
  };

  return (
    <section>
      <h1>Manual upload</h1>
      <p>Submit a report to create an incident and auto-split sections.</p>

      {success ? (
        <div className="alert success">
          <strong>Incident created.</strong> {" "}
          <Link to={`/incidents/${success.id}`}>View details</Link>
        </div>
      ) : null}

      {mutation.error instanceof Error ? (
        <div className="alert error">{mutation.error.message}</div>
      ) : null}

      <form onSubmit={handleSubmit} className="card">
        <div>
          <label htmlFor="title">Title *</label>
          <input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Payments outage"
            required
          />
        </div>

        <div>
          <label htmlFor="company">Company</label>
          <input
            id="company"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="ExampleCo"
          />
        </div>

        <div>
          <label htmlFor="date">Date</label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>

        <div>
          <label htmlFor="rawText">Raw incident text *</label>
          <textarea
            id="rawText"
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder="Impact:\nCheckout failed for 32 minutes..."
            required
          />
        </div>

        <button type="submit" disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending ? "Uploading..." : "Create incident"}
        </button>
      </form>
    </section>
  );
}
