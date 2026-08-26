import { logger } from "../lib/logger.js";
/**
 * Bearer-token auth middleware for admin routes.
 *
 * Reads `Authorization: Bearer <token>` and validates against ADMIN_TOKEN env.
 * If ADMIN_TOKEN is not set a startup warning is logged and all requests pass
 * through (dev-friendly but unsafe for production).
 */

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  logger.warn(
    "[auth] ADMIN_TOKEN is not set — admin routes are unprotected. Set ADMIN_TOKEN in .env for security."
  );
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireAdmin(req, res, next) {
  const adminToken = process.env.ADMIN_TOKEN;

  // If no token configured, allow all (dev mode)
  if (!adminToken) {
    return next();
  }

  const header = req.headers["authorization"] ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || token !== adminToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}
/**
 * Q&A routes accept either QA_TOKEN or ADMIN_TOKEN when either is configured.
 * If neither token is configured, local/dev requests pass through.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireQa(req, res, next) {
  const qaToken = process.env.QA_TOKEN;
  const adminToken = process.env.ADMIN_TOKEN;

  if (!qaToken && !adminToken) {
    return next();
  }

  const header = req.headers["authorization"] ?? "";
  const [scheme, token] = header.split(" ");
  const acceptedTokens = [qaToken, adminToken].filter(Boolean);

  if (scheme !== "Bearer" || !acceptedTokens.includes(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}

/**
 * Public for MVP demo unless READ_TOKEN_REQUIRED=true.
 * If required, accepts ADMIN_TOKEN or QA_TOKEN.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireRead(req, res, next) {
  if (process.env.READ_TOKEN_REQUIRED !== "true") {
    return next();
  }

  const qaToken = process.env.QA_TOKEN;
  const adminToken = process.env.ADMIN_TOKEN;

  if (!qaToken && !adminToken) {
    // If requirement is set but no tokens configured, fail secure
    return res.status(401).json({ error: "Unauthorized" });
  }

  const header = req.headers["authorization"] ?? "";
  const [scheme, token] = header.split(" ");
  const acceptedTokens = [qaToken, adminToken].filter(Boolean);

  if (scheme !== "Bearer" || !acceptedTokens.includes(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}
