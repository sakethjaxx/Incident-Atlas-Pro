import {
  createEmbedding,
  formatEmbeddingForSql,
} from "@pkg/nlp";

function buildIncidentEmbeddingText(incident) {
  return [
    incident.title,
    incident.company,
    incident.severity,
    ...(incident.tags ?? []),
    ...(incident.products ?? []),
    incident.summaryText,
    ...(incident.sections ?? []).map((section) => `${section.type} ${section.text}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSectionEmbeddingText(section) {
  return `${section.type}\n${section.text}`;
}

export async function safeIndexIncidentEmbeddings(client, incident) {
  try {
    const incidentVector = formatEmbeddingForSql(
      createEmbedding(buildIncidentEmbeddingText(incident))
    );

    if (incidentVector) {
      await client.$executeRawUnsafe(
        'UPDATE "incidents" SET "summary_embedding" = $1::vector WHERE "id" = $2::uuid',
        incidentVector,
        incident.id
      );
    }

    for (const section of incident.sections ?? []) {
      const sectionVector = formatEmbeddingForSql(
        createEmbedding(buildSectionEmbeddingText(section))
      );
      if (!sectionVector) continue;

      await client.$executeRawUnsafe(
        'UPDATE "sections" SET "embedding" = $1::vector WHERE "id" = $2::uuid',
        sectionVector,
        section.id
      );
    }

    return true;
  } catch (error) {
    console.warn(
      `[processor] embedding index skipped for incidentId=${incident?.id}:`,
      error?.message ?? error
    );
    return false;
  }
}
