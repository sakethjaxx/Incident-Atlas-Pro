# Incident Atlas Pro - Demo Script (5 minutes)

## Preparation (Pre-Demo)
- Start the full stack locally (`pnpm run dev`).
- Ensure the database is populated with a few seed incidents (e.g., past known outages or synthetic examples).
- Open the Web UI (`http://localhost:3000`).

## The Demo (Action & Narrative)

### 1. Ingestion & Extraction (1 minute)
**Action:** Go to the "Ingest" page. Upload a raw Markdown outage report (or paste a status page link).
**Narrative:** "During an incident, engineers need context fast. Incident Atlas Pro ingests raw incident documents and automatically sections them into Impact, Timeline, Root Cause, and Mitigation using our ingestion pipeline."

### 2. Hybrid Search (1 minute)
**Action:** Navigate to the "Search" page. Enter a query like: `latency spike after deploy + 502s`. Filter by a specific date range if applicable.
**Narrative:** "Using hybrid vector and keyword search, we instantly surface exactly relevant past incidents. Notice how the search highlights the specific matched sections within the incident."

### 3. Incident Detail & Similarity (1 minute)
**Action:** Click the top result to open the Incident Detail view. Scroll to the "Similar Incidents" panel.
**Narrative:** "In the detail view, the system flags related past outages. Crucially, it provides 'reasons' for the similarity—such as matched symptoms or the same trigger—helping responders immediately identify repeating patterns."

### 4. Knowledge Graph (1 minute)
**Action:** Click over to the "Graph Explorer". Select a "Service" or "Root Cause" node.
**Narrative:** "To understand platform-wide vulnerabilities, the Knowledge Graph plots the relationships between symptoms, causes, and services. Clicking on any edge takes us directly to the source evidence in the original incident."

### 5. (Optional) Q&A (1 minute)
**Action:** Open the Q&A interface and ask, "What usually causes database connection timeouts?"
**Narrative:** "Our evidence-first Q&A answers the question by citing exact, hard evidence from our past incidents, or explicitly refusing to answer if no historical data supports the claim. No hallucinations, just facts."
