# Incident Ingest (Week 1 Skeleton)

## Run locally
1) Start DB
   docker compose up -d

2) Install deps
   pnpm install

3) Configure env
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env

4) Migrate DB
   pnpm api:migrate

5) Run API + Web
   pnpm dev

API: http://localhost:3001
Web: http://localhost:5173

Environment variables:
- API uses `DATABASE_URL`
- Web uses `VITE_API_URL` (legacy Next.js `NEXT_PUBLIC_API_URL` is documented in `.env.example` but unused)

## Web app (Vite SPA)
Routes:
- `/` Dashboard
- `/incidents` Incident list
- `/incidents/:id` Incident detail with sections
- `/upload` Manual ingestion form

## API endpoints
- `POST /ingest/manual` Create incident + sections from raw text
- `GET /incidents` List incidents
- `GET /incidents/:id` Incident detail (includes sections)

## Manual ingest
POST http://localhost:3001/ingest/manual

Payload example:
```json
{
  "title": "Payments outage",
  "company": "ExampleCo",
  "date": "2026-01-28T10:30:00Z",
  "rawText": "Impact:\nCheckout failed for 32 minutes.\n\nTimeline:\n10:03 UTC alarms fired.\n10:22 UTC rollback complete.\n\nRoot Cause:\nBad deploy to payment-service.\n\nFix:\nPin dependency + add canary."
}
```
