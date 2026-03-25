# Data Model

## Tables (minimum)
- `sources(id, name, url, type, crawl_policy)`
- `documents(id, source_id, raw_path, hash, fetched_at, parse_status)`
- `incidents(id, title, date, company, products, duration, severity, tags, summary_text, summary_embedding)`
- `sections(id, incident_id, type[impact|timeline|rootcause|fix], text, embedding)`
- `graph_nodes(id, node_type[Service|Symptom|Trigger|RootCause|Fix|Runbook], name, attrs_json)`
- `graph_edges(id, from_node_id, rel_type[AFFECTS|HAS_SYMPTOM|TRIGGERED_BY|CAUSED_BY|RESOLVED_BY], to_node_id, incident_id, evidence_section_id)`
- `qa_queries(id, question, expected_incident_ids, created_at)`
- `audit_logs(id, action, prompt_version, input_hash, output_hash, created_at)`

## Notes
- Store embeddings in pgvector columns or an external vector DB.
- `evidence_section_id` is mandatory for graph edges and Q&A citations.
