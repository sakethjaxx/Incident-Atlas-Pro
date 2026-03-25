# Deployment

## Deployment checklist
- Env vars set (DB, Redis, storage, model refs)
- DB migrations applied
- Worker running
- Health checks green
- Smoke tests passed
- Rollback plan ready

## Rollback
- Revert to previous image/tag
- Prefer forward-fix migrations over rollback
