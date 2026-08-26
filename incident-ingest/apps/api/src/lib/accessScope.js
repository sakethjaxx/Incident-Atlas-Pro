export const DOCUMENT_SCOPE_SOURCE = "uploaded_documents";
export const PUBLIC_WEB_SCOPE_SOURCE = "public_web";

const VALID_SCOPE_SOURCES = new Set([DOCUMENT_SCOPE_SOURCE, PUBLIC_WEB_SCOPE_SOURCE]);

export class AccessScopeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AccessScopeError";
    this.status = status;
  }
}

export function normalizeAccessScope(input = {}, fallbackCompany = null) {
  const source = normalizeScopeSource(input.source ?? input.scope);
  const configuredCompanies = parseCompanyList(process.env.ACCESSIBLE_COMPANIES);
  const requestedCompanies = parseCompanyList(
    input.companies ?? input.accessCompanies ?? input.companyScope
  );
  const fallbackCompanies = fallbackCompany ? parseCompanyList(fallbackCompany) : [];

  let companies = requestedCompanies.length > 0 ? requestedCompanies : fallbackCompanies;

  if (source === DOCUMENT_SCOPE_SOURCE && configuredCompanies.length > 0) {
    if (companies.length === 0) {
      companies = configuredCompanies;
    } else {
      const allowed = new Set(configuredCompanies.map((company) => company.toLowerCase()));
      const unauthorized = companies.filter((company) => !allowed.has(company.toLowerCase()));
      if (unauthorized.length > 0) {
        throw new AccessScopeError(
          `Scope includes companies this token cannot access: ${unauthorized.join(", ")}`,
          403
        );
      }
    }
  }

  return {
    source,
    companies: dedupeCompanies(companies),
    mode: source === DOCUMENT_SCOPE_SOURCE ? "owned_and_shared" : "public_research",
  };
}

export function applyDocumentAccessScope(filters, accessScope) {
  if (accessScope.source !== DOCUMENT_SCOPE_SOURCE) return filters;
  if (filters.company && accessScope.companies.length > 0) {
    const allowed = new Set(accessScope.companies.map((company) => company.toLowerCase()));
    if (!allowed.has(filters.company.toLowerCase())) {
      throw new AccessScopeError(
        `Company filter is outside the requested document scope: ${filters.company}`,
        403
      );
    }
  }
  return {
    ...filters,
    companies: accessScope.companies,
  };
}

export function publicWebUnavailablePayload(accessScope) {
  return {
    status: "not_configured",
    message:
      "Public web research is a separate source and is not configured on this deployment.",
    scope: accessScope,
  };
}

function normalizeScopeSource(value) {
  const source = String(value ?? DOCUMENT_SCOPE_SOURCE).trim() || DOCUMENT_SCOPE_SOURCE;
  if (!VALID_SCOPE_SOURCES.has(source)) {
    throw new AccessScopeError(
      `scope.source must be ${DOCUMENT_SCOPE_SOURCE} or ${PUBLIC_WEB_SCOPE_SOURCE}`
    );
  }
  return source;
}

function parseCompanyList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseCompanyList(item));
  }
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeCompanies(companies) {
  const seen = new Set();
  const result = [];
  for (const company of companies) {
    const key = company.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(company);
  }
  return result;
}
