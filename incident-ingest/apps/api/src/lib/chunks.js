/**
 * Chunk indexing — Sprint 5 open-source RAG stack.
 *
 * Builds section + paragraph chunks for an incident, embeds them with the
 * configured provider (EMBEDDING_PROVIDER=local|bge|ollama), and writes them
 * to the `chunks` table with:
 *   • exact citation anchors (incident_id + section_id)
 *   • denormalized metadata (company/severity/tags/products) for filtering
 *   • optional TurboQuant compressed codes (TURBOQUANT_ENABLED=true)
 *
 * safeIndexIncidentChunks follows the same contract as the other safe
 * indexers: NEVER throws, returns true on success/no-op, false on error.
 */

import {
  buildChunksForIncident,
  buildChunkEmbeddingText,
  embedTexts,
  formatEmbeddingForSql,
  getRagConfig,
  describeEmbeddingProvider,
  quantizeVector,
  serializeQuantized,
} from "@pkg/nlp";
import { invalidateTqCache } from "./retrieval.js";

/**
 * Rebuild all chunks for one incident (delete + insert).
 *
 * @param {import('@prisma/client').PrismaClient} client
 * @param {{ id: string, title?: string, company?: string, severity?: string,
 *           tags?: string[], products?: string[],
 *           sections?: Array<{ id: string, type: string, text: string }> }} incident
 * @param {{ config?: ReturnType<typeof getRagConfig> }} [opts]
 * @returns {Promise<number>} number of chunks written
 */
export async function indexIncidentChunks(client, incident, opts = {}) {
  const config = opts.config ?? getRagConfig();
  const chunks = buildChunksForIncident(incident);

  await client.chunk.deleteMany({ where: { incidentId: incident.id } });
  // Invalidate TQ cache so the next retrieval reloads with updated codes.
  invalidateTqCache();
  if (chunks.length === 0) return 0;

  const texts = chunks.map((chunk) =>
    buildChunkEmbeddingText(chunk, { title: incident.title, company: incident.company })
  );
  const vectors = await embedTexts(texts, { config });
  const providerInfo = describeEmbeddingProvider(config);

  let written = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const vector = vectors[i];

    let tq = null;
    if (config.turboquant.enabled && vector) {
      const quantized = quantizeVector(vector, {
        bits: config.turboquant.bits,
        rotation: config.turboquant.rotation,
        seed: config.turboquant.seed,
        residualQjl: config.turboquant.residualQjl,
        dims: providerInfo.dimensions,
      });
      if (quantized) tq = serializeQuantized(quantized);
    }

    const row = await client.chunk.create({
      data: {
        incidentId: chunk.incidentId,
        sectionId: chunk.sectionId,
        sectionType: chunk.sectionType,
        chunkType: chunk.chunkType,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        company: incident.company ?? null,
        severity: incident.severity ?? null,
        tags: incident.tags ?? [],
        products: incident.products ?? [],
        embeddingProvider: providerInfo.provider,
        embeddingModel: providerInfo.model,
        embeddingDim: providerInfo.dimensions,
        tqCodes: tq?.codes ?? null,
        tqResidual: tq?.residual ?? null,
        tqMeta: tq?.meta ?? null,
      },
      select: { id: true },
    });

    const vectorSql = formatEmbeddingForSql(vector);
    if (vectorSql) {
      await client.$executeRawUnsafe(
        'UPDATE "chunks" SET "embedding" = $1::vector WHERE "id" = $2::uuid',
        vectorSql,
        row.id
      );
    }
    written += 1;
  }

  return written;
}

/**
 * Non-throwing wrapper used by ingest paths.
 *
 * @returns {Promise<boolean>}
 */
export async function safeIndexIncidentChunks(client, incident, opts = {}) {
  try {
    await indexIncidentChunks(client, incident, opts);
    return true;
  } catch (error) {
    console.warn(
      `[chunks] chunk index skipped for incidentId=${incident?.id}:`,
      error?.message ?? error
    );
    return false;
  }
}
