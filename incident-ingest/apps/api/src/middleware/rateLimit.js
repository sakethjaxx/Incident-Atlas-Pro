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

export const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  ...standardOptions,
});

export const jobsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  ...standardOptions,
});

export const adminIngestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
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
  limit: 10,
  keyGenerator: (req, res) => req.headers.authorization || ipKeyGenerator(req, res),
  ...standardOptions,
});
