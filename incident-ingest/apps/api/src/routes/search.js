import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { normalizeSearchParams, searchIncidents } from "@pkg/db";
import {
  DOCUMENT_SCOPE_SOURCE,
  PUBLIC_WEB_SCOPE_SOURCE,
  applyDocumentAccessScope,
  normalizeAccessScope,
  publicWebUnavailablePayload,
} from "../lib/accessScope.js";
import { requireRead } from "../middleware/auth.js";
import { publicReadLimiter } from "../middleware/rateLimit.js";

function isAdminToken(req) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return false;
  const [scheme, token] = (req.headers["authorization"] ?? "").split(" ");
  return scheme === "Bearer" && token === adminToken;
}

function buildSourceAccess(incident, scope) {
  const company = incident?.company ?? null;
  return {
    source: scope.source,
    label: scope.source === PUBLIC_WEB_SCOPE_SOURCE ? "Public web" : "Uploaded document",
    accessReason:
      scope.source === PUBLIC_WEB_SCOPE_SOURCE
        ? "This would come from public web research sources."
        : company
          ? `Visible through the ${company} document scope.`
          : "Visible through your uploaded document scope.",
  };
}


export const searchRouter = Router();

/**
 * GET /search?q=<text>&limit=<n>&page=<n>&company=<s>&severity=<s>&tag=<s>&from=<date>&to=<date>
 *
 * Hybrid FTS + vector similarity search across incident titles and section text.
 *
 * Response (frozen API_SPEC contract):
 *   {
 *     results: [
 *       {
 *         incident: { id, title, severity, date, company, tags, products, summaryText, createdAt },
 *         score: 0.89,
 *         evidence: [{ id, type, text, highlight?, score? }]
 *       }
 *     ],
 *     total: <int>,
 *     page:  <int>,
 *     limit: <int>,
 *     q:     <string>,
 *     filters: { company, severity, tag, from, to },
 *     scope: { source: "uploaded_documents" | "public_web", companies, mode },
 *     publicWeb: { status, message } | null
 *   }
 *
 * Errors:
 *   400  Missing or malformed query (q is required, must be 1–500 chars)
 */
searchRouter.get("/search", requireRead, publicReadLimiter, async (req, res, next) => {

  try {
    const params = normalizeSearchParams(req.query);

    if (!params.q) {
      return res.status(400).json({ error: "q query parameter is required" });
    }
    if (params.q.length > 500) {
      return res.status(400).json({ error: "q must be 500 characters or fewer" });
    }

    const scope = normalizeAccessScope(req.query, params.filters.company);

    if (scope.source === PUBLIC_WEB_SCOPE_SOURCE) {
      return res.json({
        results: [],
        data: [],
        total: 0,
        page: params.page,
        limit: params.limit,
        q: params.q,
        filters: {
          company: params.filters.company ?? null,
          companies: scope.companies,
          severity: params.filters.severity ?? null,
          tag: params.filters.tag ?? null,
          from: params.filters.from ? params.filters.from.toISOString() : null,
          to: params.filters.to ? params.filters.to.toISOString() : null,
        },
        scope,
        publicWeb: publicWebUnavailablePayload(scope),
      });
    }

    params.filters = applyDocumentAccessScope(params.filters, scope);
    const result = await searchIncidents(prisma, params);
    // Debug traces contain internal retrieval scores — restrict to admin callers.
    const debugMode = (req.query.debug === "1" || req.query.debug === "true") && isAdminToken(req);

    // Map internal retrieval shape → frozen API_SPEC contract.
    // retrieval.js returns items with: incident, score, matchedSections, sections, …
    // Contract shape: { incident, score, evidence: [{id, type, text, highlight, score}] }
    const results = (result.data ?? []).map((item) => {
      const incident = item.incident ?? {
        id: item.id,
        title: item.title,
        date: item.date,
        company: item.company,
        severity: item.severity,
        tags: item.tags ?? [],
        products: item.products ?? [],
        summaryText: item.summaryText,
        createdAt: item.createdAt,
      };
      return ({
      // Debug/eval mode: expose per-backend retrieval scores (additive only).
      ...(debugMode
        ? {
            trace: {
              backend: "pgvector",
              keywordScore: item.keywordScore ?? null,
              vectorScore: item.vectorScore ?? null,
              fusedScore: item.score ?? null,
              rerankScore: null,
            },
          }
        : {}),
      incident,
      score: item.score,
      sourceAccess: buildSourceAccess(incident, scope),
      evidence: (item.matchedSections ?? item.sections ?? []).map((s) => ({
        id: s.id,
        type: s.type,
        text: s.text,
        highlight: s.highlight ?? null,
        score: s.score ?? null,
      })),
    });
    });

    return res.json({
      results,
      // Keep `data` as a backward-compat alias for internal consumers / tests
      data: results,
      total: result.total,
      page: params.page,
      limit: params.limit,
      q: params.q,
      filters: {
        company: params.filters.company ?? null,
        companies: params.filters.companies ?? [],
        severity: params.filters.severity ?? null,
        tag: params.filters.tag ?? null,
        from: params.filters.from ? params.filters.from.toISOString() : null,
        to: params.filters.to ? params.filters.to.toISOString() : null,
      },
      scope: {
        ...scope,
        source: DOCUMENT_SCOPE_SOURCE,
      },
      publicWeb: null,
    });
  } catch (error) {
    return next(error);
  }
});
