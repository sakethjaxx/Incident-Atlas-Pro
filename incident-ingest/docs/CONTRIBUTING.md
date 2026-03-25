# Contributing

## Branching
- `main` (stable)
- feature branches: `feat/<ticket-id>-<short-name>`
- hotfix branches: `fix/<ticket-id>-<short-name>`

## PR rules
- Small, atomic PRs
- One feature per PR
- Include tests for every change
- No unrelated refactors in feature PRs

## Required checks
- Lint/format
- Unit tests
- Integration tests
- Migration check (fresh DB)
- Eval regression (if search/graph changed)
