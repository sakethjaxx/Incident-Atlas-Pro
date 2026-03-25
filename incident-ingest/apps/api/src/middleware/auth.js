/**
 * Bearer-token auth middleware for admin routes.
 *
 * Reads `Authorization: Bearer <token>` and validates against ADMIN_TOKEN env.
 * If ADMIN_TOKEN is not set a startup warning is logged and all requests pass
 * through (dev-friendly but unsafe for production).
 */

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  console.warn(
    "[auth] ADMIN_TOKEN is not set — admin routes are unprotected. Set ADMIN_TOKEN in .env for security."
  );
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireAdmin(req, res, next) {
  // If no token configured, allow all (dev mode)
  if (!ADMIN_TOKEN) {
    return next();
  }

  const header = req.headers["authorization"] ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}
