import express from "express";
import cors from "cors";
import "dotenv/config";

import { healthRouter } from "./routes/health.js";
import { sourcesRouter } from "./routes/sources.js";
import { documentsRouter } from "./routes/documents.js";
import { ingestRouter } from "./routes/ingest.js";
import { incidentsRouter } from "./routes/incidents.js";
import { searchRouter } from "./routes/search.js";
import { jobsRouter } from "./routes/jobs.js";

/**
 * Build and return the Express application without starting the server.
 * Exported so vitest + supertest can import it without binding to a port.
 */
export function buildApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  // Routes
  app.use(healthRouter);
  app.use(sourcesRouter);
  app.use(documentsRouter);
  app.use(ingestRouter);
  app.use(incidentsRouter);
  app.use(searchRouter);
  app.use(jobsRouter);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Global error handler
  app.use((error, _req, res, _next) => {
    console.error("[error]", error);
    const status = error.status ?? 500;
    return res
      .status(status)
      .json({ error: error.message ?? "Internal server error" });
  });

  return app;
}
