import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers['x-admin-token']",
      "ADMIN_TOKEN",
      "DATABASE_URL",
      "*.ADMIN_TOKEN",
      "*.DATABASE_URL",
      "err.config.headers.Authorization"
    ],
    censor: "[REDACTED]",
  },
});
