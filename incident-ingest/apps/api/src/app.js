import { logger } from "./lib/logger.js";
import pinoHttp from "pino-http";
import express from "express";
import cors from "cors";
import "dotenv/config";

import { healthRouter } from "./routes/health.js";
import { sourcesRouter } from "./routes/sources.js";
import { documentsRouter } from "./routes/documents.js";
import { ingestRouter } from "./routes/ingest.js";
import { incidentsRouter } from "./routes/incidents.js";
import { searchRouter } from "./routes/search.js";
import { graphRouter } from "./routes/graph.js";
import { evalRouter } from "./routes/eval.js";
import { qaRouter } from "./routes/qa.js";
import { jobsRouter } from "./routes/jobs.js";
import { metadataRouter } from "./routes/metadata.js";

// W4-H3: Restrict CORS to a known origin; override via CORS_ORIGIN in production.
// (index.js had this fix; app.js — the file actually imported by server.js — did not.)
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

/**
 * Build and return the Express application without starting the server.
 * Exported so vitest + supertest can import it without binding to a port.
 */
export function buildApp() {
  const app = express();

  // W6-M1: Ensure rate-limits check the actual user IP if deployed behind proxies
  app.set("trust proxy", 1);

  app.use(cors({ origin: ALLOWED_ORIGIN, methods: ["GET", "POST", "OPTIONS"] }));
  app.use(express.json({ limit: "10mb" }));
  app.use(pinoHttp({ logger }));


  // Routes
  app.use(healthRouter);
  app.use(sourcesRouter);
  app.use(documentsRouter);
  app.use(ingestRouter);
  app.use(incidentsRouter);
  app.use(searchRouter);
  app.use(graphRouter);
  app.use(evalRouter);
  app.use(qaRouter);
  app.use(jobsRouter);
  app.use(metadataRouter);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Global error handler.
  // SEC: In production, never forward raw error.message — it may contain Prisma
  // column names, query fragments, or stack paths. Only surface client-safe messages
  // (those explicitly set on the error object by route handlers).
  app.use((error, _req, res, _next) => {
    logger.error("[error]", error);
    const status = error.status ?? 500;
    const isClientError = status >= 400 && status < 500;
    const message =
      isClientError
        ? (error.message ?? "Bad request")
        : process.env.NODE_ENV === "production"
          ? "Internal server error"
          : (error.message ?? "Internal server error");
    return res.status(status).json({ error: message });
  });

  return app;
}
