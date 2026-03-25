# API Spec (Minimum)

## Ingestion
- `POST /sources`
- `POST /documents/upload`
- `POST /ingest/{document_id}` (async job)
- `GET /documents/{id}` (status + artifacts)

## Search
- `GET /search?q=...&from=...&to=...&company=...&tag=...`
- `GET /incidents/{id}`
- `GET /incidents/{id}/similar`

## Graph
- `GET /graph/patterns?service=...&symptom=...`
- `GET /graph/neighbors?node_id=...&depth=1`

## Evaluation
- `POST /eval/queries`
- `POST /eval/run`
- `GET /eval/latest`

## Q&A (optional)
- `POST /qa` (citations-first; refuse if unsupported)
