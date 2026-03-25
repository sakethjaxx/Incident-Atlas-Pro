# Antigravity: 7-Agent Execution Plan

**Updated:** 2026-03-07

## Agents
1. Orchestrator/Router (Gemini)
2. Research / Source-of-truth (Gemini + browsing)
3. Architect (Gemini)
4. Backend Builder (Codex)
5. Frontend Builder (Codex or Gemini)
6. QA/Security Reviewer (Codex)
7. Release/Integrator (Gemini)

## Shared artifacts
- `docs/PROJECT_SPEC.md` (single source of truth)
- `antigravity/TASK_BOARD.json` (tickets + status)
- `antigravity/agents.yaml` (agent registry + routing)
- `docs/FILE_SCOPE_RULES.md` (agent boundaries)

## Ticket lifecycle
TODO → IN_PROGRESS → READY_FOR_REVIEW → FIX_REQUESTED → DONE

## Routing policy
- research → Research agent
- design → Architect
- backend → Backend Builder
- frontend → Frontend Builder
- review/security/perf → QA Reviewer
- release/deploy → Integrator

## Hard gates
- Every code ticket auto-creates a review ticket
- Reviewer approval required to mark DONE
- Integrator runs only when all tickets DONE

## Builder QA contract (must include in every code output)
- Run backend locally
- Check DB connectivity and migrations
- Run automated tests (unit + integration)
- Add test cases for each PR
- List risks and mitigations
