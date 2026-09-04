import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { buildComparisonAnswer } from "@pkg/nlp";
import { authorizeLocalNetwork } from "../lib/auth.js";

export const compareRouter = Router();

compareRouter.post("/compare", authorizeLocalNetwork, async (req, res, next) => {
  try {
    const { incidentIds, question = "compare" } = req.body;
    if (!Array.isArray(incidentIds) || incidentIds.length < 2) {
      return res.status(400).json({ error: "At least 2 incidentIds are required for comparison" });
    }

    const incidents = await prisma.incident.findMany({
      where: { id: { in: incidentIds } },
      include: { sections: true },
    });

    if (incidents.length < 2) {
      return res.status(400).json({ error: "Could not find enough valid incidents to compare" });
    }

    // Build evidence array
    const evidence = [];
    let citationCounter = 1;
    const citations = [];

    for (const incident of incidents) {
      for (const section of incident.sections) {
        if (["impact", "rootcause", "fix"].includes(section.type)) {
          evidence.push({
            incidentId: incident.id,
            sectionId: section.id,
            sectionType: section.type,
            text: section.text,
            title: incident.title,
            company: incident.company,
            date: incident.date,
            retrievalScore: 1.0, // Manual selection implies high relevance
          });
          citations.push({
            label: `C${citationCounter++}`,
            incidentId: incident.id,
            sectionId: section.id,
            excerpt: section.text,
          });
        }
      }
    }

    const comp = buildComparisonAnswer(question, evidence, citations);
    return res.json({
      comparison: comp,
      incidents: incidents.map((i) => ({
        id: i.id,
        title: i.title,
        company: i.company,
        date: i.date,
      })),
    });
  } catch (error) {
    next(error);
  }
});
