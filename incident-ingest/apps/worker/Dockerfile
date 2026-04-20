# ── Stage: production worker image ───────────────────────────────────────────
# Build context is the repo root (incident-ingest/).
# docker build must be run from there:
#   docker build -f apps/worker/Dockerfile -t incident-worker .
# docker compose does this automatically because compose.yaml sets:
#   build: { context: ., dockerfile: apps/worker/Dockerfile }

FROM node:20-alpine

# openssl is required by Prisma's query engine at runtime on Alpine.
# Without it all DB calls throw "openssl not found".
RUN apk add --no-cache openssl

WORKDIR /app

# ── 1. Copy workspace manifests first for better layer-cache utilisation ──────
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/nlp/package.json ./packages/nlp/

# The worker uses @prisma/client whose schema lives in apps/api/prisma.
# We copy only the manifest here so pnpm install can resolve the workspace
# reference; the full prisma dir is copied below after install.
COPY apps/api/package.json ./apps/api/

# ── 2. Install only the packages needed by the worker ────────────────────────
RUN npm install -g pnpm \
  && pnpm install --filter @app/worker... --frozen-lockfile

# ── 3. Copy source code ───────────────────────────────────────────────────────
COPY apps/worker/src ./apps/worker/src
COPY packages/nlp/src ./packages/nlp/src

# Prisma schema is required by `prisma generate` and at runtime.
COPY apps/api/prisma ./apps/api/prisma

# ── 4. Generate Prisma client (uses the API's schema) ─────────────────────────
# prisma CLI is in apps/api devDependencies; use the workspace copy.
RUN cd apps/api && npx prisma generate --schema prisma/schema.prisma && cd /app

# ── 5. Runtime configuration ───────────────────────────────────────────────────
ENV NODE_ENV=production
# DATABASE_URL and REDIS_URL must be provided at runtime via docker-compose env.

CMD ["node", "apps/worker/src/worker.js"]
