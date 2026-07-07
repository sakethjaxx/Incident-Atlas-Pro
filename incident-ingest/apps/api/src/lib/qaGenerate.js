/**
 * QA answer generation — open-source generation path (Sprint 5).
 *
 * QA_PROVIDER = local | ollama
 *   local  → the existing deterministic extractive answer builder in qa.js
 *            (default; offline; used by tests).
 *   ollama → Qwen3-4B-Instruct (QA_MODEL, default qwen3:4b) served by Ollama.
 *            The model is instructed to answer ONLY from the supplied evidence
 *            and to cite a [Cn] label on every sentence. qa.js re-validates the
 *            citations after generation and falls back to the extractive
 *            answer (then to refusal) if the output is uncited or malformed.
 *
 * No Anthropic. No OpenAI.
 */

import { logger } from "./logger.js";
import { getRagConfig, ollamaGenerate } from "@pkg/nlp";

export const QA_PROMPT_VERSION_LOCAL = "qa-v1";
export const QA_PROMPT_VERSION_OLLAMA = "qa-v2-ollama";

/** Evidence chunks placed in the generation context (requirement: 5–8). */
export const OLLAMA_CONTEXT_CHUNKS = 6;

const QA_SYSTEM = [
  "You are an incident-knowledge assistant. You answer questions about past",
  "production incidents using ONLY the evidence blocks provided by the user.",
  "Rules:",
  "1. Use only facts stated in the evidence. Never invent or assume details.",
  "2. EVERY sentence in your answer must end with one or more citation labels",
  '   in square brackets, e.g. "Engineers rolled back the deploy [C1]." Valid',
  "   labels are exactly the [Cn] labels of the evidence blocks.",
  "3. If the evidence does not answer the question, reply with exactly:",
  "   INSUFFICIENT_EVIDENCE",
  "4. Be concise: 1-4 sentences. No preamble, no markdown headings.",
  "/no_think",
].join("\n");

export function getQaModel(config = getRagConfig()) {
  if (config.qa.provider === "ollama") {
    return { provider: "ollama", name: config.qa.model, version: null };
  }
  return { provider: "local", name: "extractive-citation-v1", version: null };
}

export function buildQaPrompt(question, citations) {
  const evidenceBlocks = citations
    .map(
      (citation) =>
        `[${citation.label}] (incident: ${citation.title ?? "unknown"}; company: ${
          citation.company ?? "unknown"
        }; section: ${citation.sectionType})\n${citation.excerpt}`
    )
    .join("\n\n");

  return `EVIDENCE:\n${evidenceBlocks}\n\nQUESTION: ${question}\n\nANSWER (cited sentences only):`;
}

/** Strip Qwen3 thinking blocks and normalize whitespace. */
function sanitizeGeneratedAnswer(raw) {
  return String(raw ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```[a-z]*\s*|\s*```$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Try the Ollama generation path. Returns null when the provider is `local`,
 * the model refuses (INSUFFICIENT_EVIDENCE), or anything fails — callers then
 * use the deterministic extractive answer. Never throws.
 *
 * @param {{ question: string, citations: Array<object> }} input
 * @param {ReturnType<typeof getRagConfig>} [config]
 * @returns {Promise<{ answer: string, insufficient: boolean } | null>}
 */
export async function tryOllamaAnswer(input, config = getRagConfig()) {
  if (config.qa.provider !== "ollama") return null;

  try {
    const raw = await ollamaGenerate(
      {
        model: config.qa.model,
        system: QA_SYSTEM,
        prompt: buildQaPrompt(input.question, input.citations),
        temperature: 0,
      },
      config
    );
    const answer = sanitizeGeneratedAnswer(raw);
    if (!answer) return null;
    if (/INSUFFICIENT_EVIDENCE/i.test(answer)) {
      return { answer: null, insufficient: true };
    }
    return { answer, insufficient: false };
  } catch (error) {
    logger.warn("[qa] ollama generation failed, using extractive fallback:", error?.message);
    return null;
  }
}
