# Incident Atlas Pro - 5-Minute Demo Script

## Preparation
- Ensure the application stack is running locally (`pnpm run dev`).
- Ensure the database is seeded with at least 5-10 sample incidents (e.g., previous publicly available outage reports).
- Open the web application at `http://localhost:3000` in your browser.

## Step 1: Ingestion & Upload (1 minute)
**Narrative:** "During an outage or postmortem, we need to quickly ingest disparate sources of information. Incident Atlas Pro allows engineers to upload raw incident documents or provide links to status pages, and it automatically extracts structured data."
*   **Action:** Go to the "Ingest" tab.
*   **Action:** Upload a sample Markdown or PDF incident document.
*   **Action:** Show the ingestion status pipeline as it automatically extracts the fields (Impact, Timeline, Root Cause, Mitigations) and generates embeddings.

## Step 2: Hybrid Search & Retrieval (1 minute)
**Narrative:** "Now that the incident is ingested, let's see how our hybrid search enables quick discovery of past patterned outages."
*   **Action:** Navigate to the "Search" page.
*   **Action:** Type a query representing a common symptom (e.g., "database connection timeout" or "DNS resolution failure").
*   **Action:** Show the search results, highlighting how the hybrid search (FTS + vector) surfaces relevant past incidents along with perfectly matched text selections.

## Step 3: Similarity & Reasons (1 minute)
**Narrative:** "When viewing an incident, we want to know if this has happened before and *why*."
*   **Action:** Click into a specific incident detail view.
*   **Action:** Scroll to the "Similar Incidents" panel.
*   **Action:** Emphasize the "Reasons" provided by the system (e.g., "Similar Root Cause: Connection Pool Exhaustion") explaining exactly why these incidents are linked.

## Step 4: Knowledge Graph Explorer (1.5 minutes)
**Narrative:** "To understand systemic issues across the platform, we use the Knowledge Graph Explorer."
*   **Action:** Go to the "Graph Explorer" tab.
*   **Action:** Display the visual graph showing nodes for Services, Symptoms, Root Causes, and Fixes.
*   **Action:** Click on a "Root Cause" node to reveal all edges (incidents) pointing to it, demonstrating how recurring patterns are instantly visualized with hard evidence links back to the original sections.

## Step 5: Wrap-up (0.5 minutes)
**Narrative:** "Incident Atlas Pro serves as a centralized, searchable evidence-base that reduces MTTR and prevents repeated mistakes. It's ready to use and deployable out-of-the-box."
*   **Action:** Return to the dashboard and conclude the demo.
