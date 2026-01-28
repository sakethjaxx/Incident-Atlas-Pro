import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const SECTION_TYPES = ["impact", "timeline", "rootcause", "fix"];
const LABELS = {
  impact: ["impact", "customer impact", "user impact"],
  timeline: ["timeline", "timeline of events", "events"],
  rootcause: ["root cause", "rootcause", "cause"],
  fix: ["fix", "resolution", "mitigation", "remediation", "prevention"],
};

const labelToType = new Map();
Object.entries(LABELS).forEach(([type, labels]) => {
  labels.forEach((label) => labelToType.set(label, type));
});

function normalizeLabel(line) {
  return line.trim().replace(/:$/, "").toLowerCase();
}

function buildSummary(rawText) {
  const paragraphs = rawText
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const base = paragraphs[0] || rawText.trim();
  if (!base) return null;
  return base.length > 280 ? `${base.slice(0, 277)}...` : base;
}

function splitSections(rawText) {
  const lines = rawText.split(/\r?\n/);
  const sections = [];
  let currentType = null;
  let buffer = [];

  const pushSection = () => {
    const text = buffer.join("\n").trim();
    if (!text) {
      buffer = [];
      return;
    }
    sections.push({ type: currentType || "impact", text });
    buffer = [];
  };

  for (const line of lines) {
    const label = normalizeLabel(line);
    if (labelToType.has(label)) {
      if (currentType || buffer.length) {
        pushSection();
      }
      currentType = labelToType.get(label);
      continue;
    }
    buffer.push(line);
  }
  pushSection();

  if (sections.length === 0) {
    const chunks = rawText
      .split(/\n\s*\n/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    if (chunks.length === 0) {
      return [{ type: "impact", text: rawText.trim() }];
    }
    return chunks.map((text, index) => ({
      type: SECTION_TYPES[Math.min(index, SECTION_TYPES.length - 1)],
      text,
    }));
  }

  return sections;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/incidents", async (_req, res, next) => {
  try {
    const incidents = await prisma.incident.findMany({
      select: {
        id: true,
        title: true,
        date: true,
        company: true,
        severity: true,
        tags: true,
        summaryText: true,
      },
      orderBy: [{ date: "desc" }, { title: "asc" }],
    });
    res.json(incidents);
  } catch (error) {
    next(error);
  }
});

app.get("/incidents/:id", async (req, res, next) => {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: req.params.id },
      include: { sections: true },
    });
    if (!incident) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    res.json(incident);
  } catch (error) {
    next(error);
  }
});

app.post("/ingest/manual", async (req, res, next) => {
  try {
    const { title, company, date, rawText } = req.body || {};

    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (!rawText || typeof rawText !== "string") {
      res.status(400).json({ error: "rawText is required" });
      return;
    }

    let parsedDate = null;
    if (date) {
      const candidate = new Date(date);
      if (Number.isNaN(candidate.getTime())) {
        res.status(400).json({ error: "date must be ISO-8601" });
        return;
      }
      parsedDate = candidate;
    }

    const sections = splitSections(rawText);
    const summaryText = buildSummary(rawText);

    const incident = await prisma.incident.create({
      data: {
        title: title.trim(),
        company: typeof company === "string" ? company.trim() : null,
        date: parsedDate,
        summaryText,
        severity: null,
        tags: [],
        sections: {
          create: sections,
        },
      },
      include: {
        sections: true,
      },
    });

    res.status(201).json(incident);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
