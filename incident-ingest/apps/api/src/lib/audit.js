import crypto from "node:crypto";

function sha256(value) {
  if (value === undefined || value === null) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stableJson(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = sortJson(value[key]);
      return acc;
    }, {});
}

export function resolveActor(req) {
  const header = req?.headers?.authorization ?? "";
  const [scheme, token] = String(header).split(" ");

  if (scheme === "Bearer" && token) {
    return {
      actorType:
        token === process.env.ADMIN_TOKEN
          ? "admin_token"
          : token === process.env.QA_TOKEN
            ? "qa_token"
            : "bearer_token",
      actorHash: sha256(token),
    };
  }

  return { actorType: "anonymous", actorHash: null };
}

export async function writeAuditLog(client, req, entry) {
  try {
    const actor = resolveActor(req);
    const inputJson = stableJson(entry.input);
    const outputJson = stableJson(entry.output);
    const ip = req?.ip ?? req?.headers?.["x-forwarded-for"] ?? null;

    return await client.auditLog.create({
      data: {
        action: entry.action,
        actorType: actor.actorType,
        actorHash: actor.actorHash,
        ipHash: ip ? sha256(ip) : null,
        route: entry.route,
        method: entry.method,
        status: entry.status,
        statusCode: entry.statusCode,
        latencyMs: entry.latencyMs ?? null,
        promptVersion: entry.promptVersion ?? null,
        promptTemplateHash: entry.promptTemplateHash ?? null,
        provider: entry.provider ?? null,
        model: entry.model ?? null,
        modelVersion: entry.modelVersion ?? null,
        modelConfigJson: entry.modelConfig ?? null,
        inputHash: inputJson ? sha256(inputJson) : null,
        outputHash: outputJson ? sha256(outputJson) : null,
        retrievedSectionIds: entry.retrievedSectionIds ?? [],
        retrievedIncidentIds: entry.retrievedIncidentIds ?? [],
        refusalCode: entry.refusalCode ?? null,
        artifactPath: entry.artifactPath ?? null,
        metadataJson: entry.metadata ?? null,
      },
    });
  } catch (error) {
    console.warn("[audit] write skipped:", error?.message ?? error);
    return null;
  }
}
