# File Scope Rules (Agent Boundaries)

**Updated:** 2026-03-07

## Orchestrator/Router (Gemini)
- Can edit: `antigravity/**`, `docs/**` (planning only)

## Research / Source-of-truth (Gemini + browsing)
- Can edit: `docs/SOURCES.md`, `docs/references.md`
- Cannot edit: production code

## Architect (Gemini)
- Can edit: `docs/API_SPEC.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`
- Can propose schema changes; Builder implements

## Backend Builder (Codex)
- Can edit: `apps/api/**`, `apps/worker/**`, `packages/nlp/**`, `packages/eval/**`
- `infra/**` only if a ticket requires it

## Frontend Builder (Codex/Gemini)
- Can edit: `apps/web/**`

## QA/Security Reviewer (Codex)
- Can edit: tests anywhere relevant
- Only fixes/tests/safety improvements (no new features)

## Release/Integrator (Gemini)
- Can edit: `infra/**`, `README.md`, `docs/DEPLOYMENT.md`, `docs/DEMO_SCRIPT.md`
