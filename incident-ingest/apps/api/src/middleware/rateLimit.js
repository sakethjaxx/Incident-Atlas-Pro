import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Centralized custom handler to match the exact Sprint 4 API Spec error payload
const customHandler = (req, res, next, options) => {
  return res.status(options.statusCode).json({
    error: "Rate limit exceeded",
    retryAfterSeconds: Math.ceil(options.windowMs / 1000),
  });
};

const standardOptions = {
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: customHandler,
};

// Env-overridable limits so benchmark/load runs don't need code changes.
// Defaults match the Sprint 4 spec values.
function envLimit(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: envLimit("READ_RATE_LIMIT_PER_MIN", 60),
  ...standardOptions,
});

export const jobsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  ...standardOptions,
});

export const adminIngestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: envLimit("INGEST_RATE_LIMIT_PER_MIN", 10),
  keyGenerator: (req, res) => req.headers.authorization || ipKeyGenerator(req, res),
  ...standardOptions,
});

export const evalQueriesLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  keyGenerator: (req, res) => req.headers.authorization || ipKeyGenerator(req, res),
  ...standardOptions,
});

export const evalRunsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 3,
  keyGenerator: (req, res) => req.headers.authorization || ipKeyGenerator(req, res),
  ...standardOptions,
});

export const evalLatestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  ...standardOptions,
});

export const qaLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: envLimit("QA_RATE_LIMIT_PER_MIN", 10),
  keyGenerator: (req, res) => req.headers.authorization || ipKeyGenerator(req, res),
  ...standardOptions,
});
