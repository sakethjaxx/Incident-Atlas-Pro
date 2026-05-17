# References & Model Choices

**Updated:** 2026-05-10

## Sprint 2 Retrieval Carry-Forward

### Embedding Models

| Model | Provider | Context | Dimensions | Cost / 1M Tokens | Justification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`text-embedding-3-small`** | OpenAI | 8191 | 1536 | $0.02 | **Primary choice.** Best price/performance for Sprint 2 retrieval and already aligned to the shipped vector schema. |
| **`all-MiniLM-L6-v2` via `@xenova/transformers`** | Hugging Face (Local) | 256 | 384 | $0 (self-hosted) | **Fallback choice.** Runs locally in Node.js and keeps dev/CI unblocked when external APIs are unavailable. |

### Reranking Models

| Model | Provider | Context | Language | Justification |
| :--- | :--- | :--- | :--- | :--- |
| **`rerank-english-v3.0`** | Cohere | 4096 | English | **Deferred to Sprint 4.** Current dataset size does not justify another latency and infra hop yet. |
| **`bge-reranker-v2-m3`** | BAAI | 8192 | Multilingual | **Deferred open-source fallback.** Keep as an eval option, not part of Sprint 3 scope. |

## Sprint 3 Graph Extraction Recommendation

### Decision Summary

| Decision | Recommendation | Why |
| :--- | :--- | :--- |
| Primary extraction approach | **Hybrid pipeline**: LLM extraction first, deterministic rule fallback second | LLM extraction is better at recovering entities from varied postmortem prose, but Sprint 3 ingest cannot fail closed when the model is unavailable or low-confidence. |
| Default model tier | **Claude Haiku 4.5** | Anthropic positions Haiku 4.5 as its fastest model tier, and the extraction task here is short-context, schema-constrained, and latency-sensitive. |
| Escalation model | **Claude Sonnet 4.6** only for evals or targeted retry jobs | Better reasoning headroom, but materially higher cost than Haiku for a narrow extraction schema. |
| Visualization library | **`react-force-graph-2d`** | Fastest fit for the existing Vite + React 18 app, with React-native rendering and interaction hooks. |
| Ship node types now | **`service`**, **`symptom`**, **`root_cause`**, **`fix`** | Highest signal, maps to current incident structure, and can be grounded in evidence sections today. |
| Defer node types | **`team`**, **`person`**, **`vendor`**, **`region`**, **`runbook`**, **`metric`**, **`dependency`**, **`ticket`** | These need stronger normalization rules or metadata we do not reliably capture yet. |

### Extraction Strategy Tradeoffs

| Approach | Strengths | Risks | Sprint 3 Verdict |
| :--- | :--- | :--- | :--- |
| LLM only | Best recall on messy prose; easiest way to recover relations from natural language | Can over-extract generic nouns, adds provider dependency, and creates ingest fragility if used without a fallback | Not safe enough as a standalone path |
| Rule-based only | Deterministic, cheap, easy to test, and safe in CI/offline mode | Misses varied phrasing and relation structure across real postmortems | Keep as fallback only |
| Hybrid (recommended) | High recall on the happy path, deterministic recovery path on model failure, compatible with backfill retries | Slightly more code and evaluation work | Best fit for Sprint 3 |

### Recommended Extraction Contract Inputs

- Run extraction **per section**, not across the full incident blob.
- Pass `section.id`, `section.type`, `section.text`, incident title, and company metadata into the extraction prompt.
- Force a **fixed JSON schema** with `nodes[]` and `edges[]` so the API layer never parses free-form prose.
- Require every edge candidate to include:
  - `source_name`
  - `target_name`
  - `rel_type`
  - `evidence_section_id`
  - `confidence`

### Guardrails To Prevent Graph Pollution

- Keep a hard whitelist for node types: `service`, `symptom`, `root_cause`, `fix`.
- Normalize node names before upsert: lowercase key, trim whitespace, collapse repeated spaces, preserve original display label separately.
- Reject generic low-information candidates such as `issue`, `problem`, `service`, `system`, `database`, `error`, `latency`, and `outage` when they appear without a specific modifier.
- Start with a **minimum confidence threshold of `0.75`** for the LLM path and tighten later if evals show over-extraction.
- Never write an edge without a real `evidence_section_id`; missing evidence should cause the candidate edge to be dropped, not partially stored.

### Rule Fallback Scope

- `service`: exact title/company/tag matches and product-like capitalized tokens that appear repeatedly.
- `symptom`: section-aware patterns from `impact` and `timeline` text such as error classes, elevated latency, partial outage, or request failures.
- `root_cause`: phrases following cues like `caused by`, `due to`, `triggered by`, `because`, and similar causal markers inside `root_cause` sections.
- `fix`: mitigation/remediation phrases following cues like `fixed by`, `mitigated by`, `rolled back`, `disabled`, `restarted`, `scaled`, or `patched`.

The fallback should aim for **high precision, not parity** with the LLM path. Its job is to keep ingest resilient and provide a resumable floor for backfill.

## Sprint 3 Graph UI Recommendation

### Library Comparison

| Library | Fit For This Repo | Tradeoffs | Verdict |
| :--- | :--- | :--- | :--- |
| `react-force-graph-2d` | Direct React component model, easy to wire into existing route/panel structure, canvas rendering works well for small graphs | Less deterministic than Cytoscape layouts; labels need careful design on mobile | **Recommended for Sprint 3** |
| Cytoscape.js | Richer layout algorithms and stronger long-term graph-analysis ergonomics | More setup complexity in React and more surface area than Sprint 3 needs | Good upgrade path, not fastest ship path |
| vis-network | Solid hierarchical views and clustering support | More imperative API shape and weaker React fit than the top two options | Not the best fit here |

### Why `react-force-graph-2d`

- It matches the current app architecture: plain React 18 plus Vite, no heavy UI framework to work around.
- The shipped Sprint 3 graph is intentionally small: neighbor depth is capped at `2`, and the UI only needs incident-centric exploration rather than advanced graph authoring.
- The library already exposes the interactions Sprint 3 needs: click, hover, drag, custom node rendering, and lightweight force-layout previews.
- We can keep the response contract library-agnostic so Cytoscape remains a clean future swap if Sprint 4 needs richer deterministic layouts.

### UI Shape To Optimize For

- `/graph` should remain **evidence-first**: filters and result cards first, graph preview second.
- The incident detail page should use the graph panel as a **navigation aid**, not the only source of truth.
- Every visible edge in the UI should have an adjacent path to its source evidence section, even if the graph canvas itself is only a preview.

## Research Outcome For `S3-ARCH-001`

The architecture ticket can now freeze these assumptions:

1. Use a **hybrid extraction contract** with Claude Haiku 4.5 as the default LLM path and deterministic rules as the non-blocking fallback.
2. Keep Sprint 3 node scope intentionally narrow: `service`, `symptom`, `root_cause`, `fix`.
3. Enforce `evidence_section_id` on every edge at write time.
4. Default the first graph UI implementation to `react-force-graph-2d`, while keeping API payloads library-agnostic.

## Sprint 4 Quality, Q&A, Auth, and Readiness Recommendation

### Decision Memo For `S4-ARCH-001`

Sprint 4 should freeze a conservative quality stack: database-backed eval queries seeded from checked-in fixtures, citations-first Q&A over incident sections, strict refusal on insufficient evidence, token-gated mutation and Q&A routes in production, route-specific rate limits, and audit logs that store prompt/output hashes rather than raw sensitive text.

Primary sources for the architect:
- Stanford IR book evaluation chapters for Recall@K, ranked retrieval, and NDCG: [unranked retrieval](https://nlp.stanford.edu/IR-book/html/htmledition/evaluation-in-information-retrieval-1.html), [ranked retrieval](https://nlp.stanford.edu/IR-book/html/htmledition/evaluation-of-ranked-retrieval-results-1.html).
- Ragas metric catalog for RAG-style context and answer metrics: [Ragas available metrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/).
- OWASP API Security 2023 for auth and rate-limit risk: [Broken Authentication](https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/), [Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/), [Broken Function Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/).
- OWASP LLM guidance for prompt-injection risk: [LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/).
- OWASP application logging guidance: [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).
- Deployment readiness references: [Twelve-Factor Config](https://www.12factor.net/config), [Docker Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/), [PostgreSQL pg_isready](https://www.postgresql.org/docs/current/app-pg-isready.html).

### Evaluation Dataset And Artifacts

Use `qa_queries` as the canonical mutable store and keep a checked-in JSON seed file for deterministic CI/demo reset. The seed format should be importable into the database and should include:

| Field | Recommendation |
| :--- | :--- |
| `id` | Stable slug or UUID so historical reports remain comparable. |
| `question` | User-facing natural-language query. |
| `expected_incident_ids` | Required for search and Q&A retrieval scoring. |
| `expected_section_ids` | Optional but recommended for citation and graph-evidence scoring. |
| `expected_graph_node_ids` | Optional for graph-neighbor retrieval cases. |
| `query_type` | `search`, `graph`, `qa`, or `mixed`. |
| `critical` | Boolean; critical misses fail CI even when aggregate metrics remain healthy. |
| `tags` | Scenario labels such as `rootcause`, `fix`, `comparison`, `refusal`, `prompt_injection`. |

Store every eval run as an immutable artifact plus a latest pointer. The report should include run ID, timestamp, git SHA when available, query set version, retrieval config, graph expansion config, prompt version, model/provider metadata, thresholds, per-query results, aggregate metrics, and pass/fail decision. `GET /eval/latest` should return the latest report summary plus the artifact path.

### Recommended Metrics

Search retrieval:
- **Recall@5 and Recall@10** as the primary metrics. These directly answer whether expected incidents are present in the first page and the expanded result set.
- **MRR** as the ranking-quality metric. It rewards moving the first relevant incident toward rank 1 without overfitting on exact score values.
- **NDCG@10** optional until the dataset has graded relevance beyond binary expected IDs.
- **Zero-result rate** and **critical query miss count** as operational guardrails.

Graph retrieval:
- **Graph evidence recall@K**: for graph-labeled queries, the returned neighbor/pattern evidence should include expected `incident_id` or `evidence_section_id` within the top K graph-derived evidence candidates.
- **Neighbor node recall@depth**: for seeded node-centric cases, expected adjacent node IDs should appear at depth 1 or 2 as specified.
- **Evidence edge coverage**: 100% of returned graph edges must include `evidence_section_id`.
- **Anchor validity**: 100% of graph evidence anchors must resolve to `#section-{section.type}-{section.id}` on the incident detail payload.
- **Over-return guard**: patterns should remain paginated and neighbors should stay depth-capped at 2, with response-size telemetry recorded in eval artifacts.

Q&A:
- **Citation precision**: every cited section ID exists, belongs to a retrieved evidence packet, and supports the sentence it is attached to.
- **Context recall**: expected sections or incidents for answerable questions appear in the retrieved evidence before generation.
- **Grounded answer pass rate**: factual answer sentences must be supported by cited excerpts; unsupported claims fail the query.
- **Refusal accuracy**: unsupported, broad, out-of-corpus, and malicious prompt-injection questions should return refusal responses rather than invented answers.
- **Prompt-injection pass rate**: retrieved incident text or user questions that attempt to override instructions must not change the evidence-only answer contract.

### Thresholds And CI Gate

Start small and strict where it matters:

| Gate | Initial Sprint 4 recommendation |
| :--- | :--- |
| Critical queries | Fail if any critical query loses all expected incidents from Recall@5. |
| Aggregate search | Fail if Recall@5 or MRR drops by more than 5 percentage points from the checked-in baseline. |
| Graph evidence | Fail if any returned graph edge lacks `evidence_section_id`; warn on graph recall drops until at least 20 graph-specific queries exist. |
| Q&A citations | Fail if an answerable Q&A response has uncited factual claims or citations outside retrieved evidence. |
| Refusals | Fail if seeded refusal or prompt-injection queries return an answer instead of `status: "refused"`. |
| Flaky external model calls | Eval runner should support deterministic fixture mode for CI and live model mode for manual release smoke. |

This avoids turning a 30-50 query seed into a brittle scoreboard while still blocking regressions that break the product promise.

### Citations-First Q&A Flow

Recommended flow for `POST /qa`:

1. Authenticate and rate-limit before retrieval.
2. Normalize and validate the question length, but do not rewrite the user intent silently.
3. Retrieve candidate incident sections with the existing hybrid search path. Use top 8 sections as the default evidence budget.
4. Expand evidence only when useful: for root-cause/fix/pattern questions, add depth-1 graph edges whose `evidence_section_id` points to a retrieved incident or directly relevant neighbor. Do not let graph expansion introduce uncited prose; only sections enter the prompt.
5. Dedupe sections by `section.id`, cap excerpts, and build an evidence packet with stable labels such as `C1`, `C2`, `C3`.
6. Run a sufficiency gate before generation:
   - No retrieved section: refuse.
   - Comparison question with fewer than two relevant incidents: refuse.
   - Root-cause/fix question with no rootcause/fix section or graph edge evidence: refuse.
   - Retrieval dominated by low-confidence or unrelated sections: refuse.
7. Generate with a prompt that says all claims must be supported by citation labels and no outside knowledge may be used.
8. Post-validate that citations reference only retrieved section labels and that answer sentences contain citations. If validation fails, return a refusal or a terse "insufficient evidence" answer.
9. Write an audit log for both answer and refusal paths.

Recommended answer shape:
- `status`: `answered`
- `answer`: short prose with citation labels
- `citations[]`: `incident_id`, `section_id`, `section_type`, `title`, `company`, `date`, `excerpt`, `anchor`, `retrieval_score`
- `prompt_version`
- `model`
- `evidence_count`

Recommended refusal shape:
- `status`: `refused`
- `reason_code`: `insufficient_evidence`, `unsupported_scope`, `unsafe_prompt`, or `rate_limited`
- `message`: "I do not have enough cited incident evidence to answer that."
- `citations`: empty by default; use an explicit `insufficient_evidence` debug field only in non-production eval mode.

### Auth And Rate-Limit Hardening

Use a route-group policy that is secure in production and still gentle for local demos.

| Route group | Auth recommendation | Initial rate limit |
| :--- | :--- | :--- |
| `GET /health` | Public | No strict app limit; infrastructure healthchecks allowed. |
| `GET /incidents`, `GET /incidents/:id`, `GET /search`, `GET /graph/*` | Public for MVP demo unless deployment sets `READ_TOKEN_REQUIRED=true` | 60 req/min/IP, graph neighbors capped by depth and response size. |
| `GET /jobs/:jobId` | Public only for unguessable UUID job IDs; token optional in production | Keep existing 60 req/60s/IP. |
| `POST /ingest/*`, `POST /sources` | `Authorization: Bearer ADMIN_TOKEN` whenever `ADMIN_TOKEN` is set; required in production | 10 req/min/token or IP; uploads also enforce file size/type limits. |
| Scraping/fetch jobs | Admin-triggered only | 1 request/sec/domain, plus 30 enqueue requests/hour/admin token. |
| `POST /eval/queries`, `POST /eval/run` | Admin token required | 5 req/min/token for query mutation, 3 eval runs/hour/token. |
| `GET /eval/latest` | Public in local/demo; token-gated in production if reports expose internal config | 30 req/min/IP. |
| `POST /qa` | Require `QA_TOKEN` or `ADMIN_TOKEN` in production; allow unauthenticated local dev only when no token env var is configured | 10 req/min/token or IP, burst 5, max question length 1000 chars. |

Error responses should be consistent and boring:
- `401 { "error": "Unauthorized" }` for missing or invalid bearer token.
- `403 { "error": "Forbidden" }` if a valid token lacks route permission after role support exists.
- `429 { "error": "Rate limit exceeded", "retryAfterSeconds": n }`.
- `500 { "error": "Internal server error" }` with no stack traces, prompts, provider payloads, or secrets.

### Audit Logging

`audit_logs` should cover prompt-producing routes and admin mutations. Store enough to reproduce and compare behavior without storing raw secrets or sensitive prompt payloads.

Recommended fields:
- `id`, `created_at`, `request_id`, `action`
- `actor_type`, `actor_hash`, `ip_hash`
- `route`, `status`, `status_code`, `latency_ms`
- `prompt_version`, `prompt_template_hash`
- `provider`, `model`, `model_version`, `model_config_json`
- `input_hash`, `output_hash`
- `retrieved_section_ids`, `retrieved_incident_ids`
- `refusal_code`
- `artifact_path` for eval runs
- `metadata_json` for non-sensitive counters such as evidence count and token usage

Do not store raw bearer tokens, raw prompts, raw user questions, raw model outputs, stack traces, or provider API keys. If temporary raw capture is needed for local debugging, it should require an explicit non-production env flag and should never be enabled in release smoke.

### Deployment And Demo Readiness

Use seeded demo fixtures for the canonical smoke path. Live ingestion from external sources can remain an optional demo extension, but the release gate should be reproducible from a clean environment.

Minimum Sprint 4 smoke path:
1. Run migrations from scratch.
2. Verify Postgres readiness, Redis readiness, API `/health`, and worker queue connectivity.
3. Seed or ingest the payment-api demo fixture.
4. Poll job completion when using upload ingest.
5. Run `/search` and verify expected incident evidence.
6. Run `/graph/patterns` and `/graph/neighbors` and verify every edge has `evidence_section_id`.
7. Run `POST /qa` with an answerable question and verify at least one citation deep-links to an existing section anchor.
8. Run `POST /qa` with an unsupported question and verify refusal.
9. Run `POST /eval/run` or fixture eval mode and verify `GET /eval/latest` returns the report.
10. Spot-check `401` and `429` behavior for protected/rate-limited routes.

### Tradeoffs And Risks

| Area | Tradeoff | Recommendation |
| :--- | :--- | :--- |
| Eval storage | DB-backed queries are easy to mutate; JSON fixtures are easier to diff and reset. | Use both: JSON seeds import into `qa_queries`, DB is runtime source of truth. |
| CI strictness | Hard aggregate thresholds are noisy on small datasets. | Hard-fail critical misses and citation/refusal violations; use aggregate delta gates after baseline. |
| Graph expansion | Graph neighbors can improve causal/fix evidence, but can pollute Q&A context if unchecked. | Use graph only to find more evidence sections, never as standalone answer text. |
| Q&A generation | Richer answers are tempting but increase hallucination risk. | Prefer short answers with citations attached to each factual claim. |
| Auth in demos | Strict auth can slow local demos. | Token-gate production; allow local no-token only when no token env vars are configured. |
| Audit detail | Raw prompts simplify debugging but can leak sensitive data. | Store hashes, versions, model config, and retrieved IDs by default. |

### Research Outcome For `S4-ARCH-001`

The architecture ticket can now freeze these assumptions:

1. `qa_queries` plus a checked-in seed fixture is the Sprint 4 eval dataset contract.
2. Eval metrics are Recall@5, Recall@10, MRR, graph evidence recall, evidence edge coverage, citation precision, grounded answer pass rate, and refusal accuracy.
3. CI should fail critical retrieval misses, missing graph evidence pointers, uncited Q&A claims, and refusal regressions; aggregate metric gates start as baseline deltas.
4. `POST /qa` must retrieve sections before generation, optionally use graph edges only to discover evidence sections, and refuse when evidence is insufficient.
5. Production mutation and Q&A routes should require bearer tokens and route-specific rate limits; local demos may remain tokenless only when auth env vars are unset.
6. `audit_logs` should store prompt versions, hashes, model metadata, retrieved IDs, action/status, and artifact paths without raw secrets or raw prompt/output text.
