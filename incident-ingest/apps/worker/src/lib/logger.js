import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "ADMIN_TOKEN",
      "DATABASE_URL",
      "*.ADMIN_TOKEN",
      "*.DATABASE_URL",
    ],
    censor: "[REDACTED]",
  },
});
