# ── Stage: production API image ──────────────────────────────────────────────
# Build context is the repo root (incident-ingest/).
# docker build must be run from there:
#   docker build -f apps/api/Dockerfile -t incident-api .
# docker compose does this automatically because compose sets:
#   build: { context: ., dockerfile: apps/api/Dockerfile }

FROM node:20-alpine

# openssl is required by Prisma's query engine at runtime on Alpine.
# Without it `prisma migrate deploy` and all DB calls throw "openssl not found".
RUN apk add --no-cache openssl

WORKDIR /app

# ── 1. Copy workspace manifests first for better layer-cache utilisation ──────
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/nlp/package.json ./packages/nlp/

# ── 2. Install only the packages needed by the API ───────────────────────────
# --frozen-lockfile ensures CI-reproducible installs.
# `--filter @app/api...` installs the API and all its workspace dependencies.
RUN npm install -g pnpm \
  && pnpm install --filter @app/api... --frozen-lockfile

# ── 3. Copy source code ─────────────────────────────────────────────────────
COPY apps/api/src ./apps/api/src
COPY packages/nlp/src ./packages/nlp/src

# Prisma schema + migrations are required for `prisma generate` and
# `prisma migrate deploy` at startup.
COPY apps/api/prisma ./apps/api/prisma

# ── 4. Generate Prisma client ────────────────────────────────────────────────
RUN cd apps/api && npx prisma generate

# ── 5. Create uploads directory ──────────────────────────────────────────────
# multer needs this directory at runtime.
RUN mkdir -p /app/apps/api/uploads

# ── 6. Runtime configuration ────────────────────────────────────────────────
ENV NODE_ENV=production
# PORT, DATABASE_URL, REDIS_URL, ADMIN_TOKEN, CORS_ORIGIN must be provided
# at runtime via docker-compose env or secrets.

EXPOSE 3001

# Run migrations then start the server.
# In production, migrations are run via `prisma migrate deploy` which only
# applies pending migrations and never prompts interactively.
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && node src/server.js"]
