# Sources (Document Resources)

**Owner:** Research (Gemini) drafts, Architect finalizes, Orchestrator locks scope.  
**Updated:** 2026-03-07

## Phase 1 sources (start here)
Pick sources that consistently include 2+ of:
- impact
- timeline
- root cause
- fix/mitigation

## Acceptance rules
Accept a source if we can reliably extract at least **2 of 4** sections and we can store the raw artifact for human review.

## Rate limiting
- Default: 1 request/second per domain
- Cache by URL hash and store fetch timestamps

## Template
- Name: Cloudflare Outage Reports
- Type: blog
- Base URL: https://blog.cloudflare.com/tag/outage/
- Example URLs (3): 
  - https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/
  - https://blog.cloudflare.com/post-mortem-7-1d-24/
  - https://blog.cloudflare.com/cloudflare-outage-on-october-30-2023/
- Parsing approach: Markdown extraction from blog posts; focus on headers like "Incident Timeline", "Root Cause", "Remediation".
- Expected fields: impact, timeline, root_cause, mitigation
- Notes: Highly detailed, technical, and consistent.

- Name: Google Cloud Service Health Bulletins
- Type: statuspage
- Base URL: https://cloud.google.com/support/bulletins
- Example URLs (3):
  - https://cloud.google.com/support/bulletins#gcp-2024-001 (Example anchor)
  - https://cloud.google.com/support/bulletins/topics/cloud-storage
  - https://cloud.google.com/support/bulletins/topics/compute-engine
- Parsing approach: Scrape bulletin list, follow links to detailed reports.
- Expected fields: impact, timeline, root_cause
- Notes: Standardized format but sometimes less technical than blogs.

- Name: GitHub Status History
- Type: statuspage
- Base URL: https://www.githubstatus.com/history
- Example URLs (3):
  - https://www.githubstatus.com/incidents/xxxxxxxx (Incident IDs vary)
- Parsing approach: Scrape incident pages; extract "Resolved", "Monitoring", "Identified", "Investigating" timestamps.
- Expected fields: impact, timeline
- Notes: Good for timeline data; root cause often brief.

- Name: Dan Luu's Post-Mortems (Curated)
- Type: github
- Base URL: https://github.com/danluu/post-mortems
- Example URLs (3):
  - https://github.com/danluu/post-mortems/blob/master/README.md
- Parsing approach: Use as a directory to discover new specific source domains.
- Expected fields: Link to raw post-mortem
- Notes: Excellent for high-density historical data.
