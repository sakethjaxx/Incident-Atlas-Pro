# Sources (Document Resources)

**Updated:** 2026-05-10

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

## Model Binaries
- **Hugging Face Hub (`@xenova/transformers`)**: Used for downloading local fallback ONNX models (`all-MiniLM-L6-v2`) on first run. Cache locally to avoid CI flakiness.

## Sprint 3 Contract Sources

- Name: Anthropic Models Overview
- Link: https://docs.anthropic.com/en/docs/models-overview
- Why it matters: Confirms the currently documented Claude model families, aliases, context windows, and the cost gap between Haiku-tier and Sonnet-tier models.

- Name: Anthropic Tool Use Guide
- Link: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use
- Why it matters: Shows the `input_schema` pattern for forcing structured tool payloads instead of parsing free-form prose during extraction.

- Name: Anthropic Output Consistency Guide
- Link: https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails/increase-consistency
- Why it matters: Documents the prompt controls most relevant to extraction quality: examples, explicit formats, and consistency-oriented prompting.

- Name: Claude Haiku 4.5 Product Page
- Link: https://www.anthropic.com/claude/haiku
- Why it matters: Current product-level confirmation that Haiku 4.5 is the fast/low-latency Claude tier, which fits per-section graph extraction.

- Name: React Force Graph README
- Link: https://github.com/vasturiano/react-force-graph
- Why it matters: Documents the React-native graph packages, 2D/3D variants, and built-in interaction hooks suitable for a Vite + React 18 app.

- Name: Cytoscape.js Documentation
- Link: https://js.cytoscape.org/
- Why it matters: Primary source for richer layout algorithms and graph-analysis ergonomics; useful as the main alternative to React Force Graph.

- Name: Cytoscape Blog: Layouts
- Link: https://blog.js.cytoscape.org/2020/05/11/layouts/
- Why it matters: Explains why smaller subgraphs and targeted layouts are usually more useful than dumping an entire graph to screen at once.

- Name: vis-network Layout Documentation
- Link: https://visjs.github.io/vis-network/docs/network/layout.html
- Why it matters: Baseline comparison for hierarchical layout and clustering behavior, which helps explain why it is less React-native than the chosen option.

## Sprint 4 Contract Sources

- Name: Stanford IR Book - Evaluation in Information Retrieval
- Link: https://nlp.stanford.edu/IR-book/html/htmledition/evaluation-in-information-retrieval-1.html
- Why it matters: Source for basic retrieval evaluation framing such as precision and recall, used to justify Recall@K for search and retrieval quality.

- Name: Stanford IR Book - Evaluation of Ranked Retrieval Results
- Link: https://nlp.stanford.edu/IR-book/html/htmledition/evaluation-of-ranked-retrieval-results-1.html
- Why it matters: Source for ranked retrieval evaluation, especially NDCG-style scoring when relevance judgments become graded.

- Name: Ragas Available Metrics
- Link: https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/
- Why it matters: Provides RAG evaluation vocabulary for context recall/precision, response groundedness, and answer relevance; useful for Sprint 4 Q&A eval naming.

- Name: OWASP API Security 2023 - Broken Authentication
- Link: https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/
- Why it matters: Citable API security baseline for requiring bearer-token protection on admin, eval mutation, and production Q&A endpoints.

- Name: OWASP API Security 2023 - Unrestricted Resource Consumption
- Link: https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/
- Why it matters: Citable basis for route-specific rate limits, upload limits, Q&A cost controls, and eval-run throttles.

- Name: OWASP API Security 2023 - Broken Function Level Authorization
- Link: https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/
- Why it matters: Supports separate admin/eval/Q&A route authorization decisions rather than relying on public route defaults.

- Name: OWASP LLM01 Prompt Injection
- Link: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- Why it matters: Supports prompt-injection tests, retrieved-content distrust, and refusal behavior for malicious Q&A inputs.

- Name: OWASP Logging Cheat Sheet
- Link: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- Why it matters: Baseline for useful security logging without leaking sensitive data; used for the Sprint 4 audit log recommendation.

- Name: OWASP Error Handling Cheat Sheet
- Link: https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- Why it matters: Supports safe 401/403/429/500 response guidance without stack traces, provider payloads, prompts, or secrets.

- Name: Twelve-Factor App - Config
- Link: https://www.12factor.net/config
- Why it matters: Source for env-var-driven production configuration, including auth tokens, rate-limit settings, provider keys, and demo overrides.

- Name: Docker Compose Startup Order
- Link: https://docs.docker.com/compose/how-tos/startup-order/
- Why it matters: Source for deployment readiness checks around API, worker, Postgres, Redis, and service health dependencies.

- Name: PostgreSQL pg_isready
- Link: https://www.postgresql.org/docs/current/app-pg-isready.html
- Why it matters: Source for database readiness checks used in deployment and smoke-test recommendations.
