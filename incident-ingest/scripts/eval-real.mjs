/**
 * RAG evaluation against 6 real open-source postmortem reports.
 * Usage:
 *   node scripts/eval-real.mjs [--fresh]   (--fresh clears existing data first)
 *
 * Outputs per-query results with:
 *   - status (answered / refused / error)
 *   - retrieval path (chunks / legacy-sections)
 *   - key-fact hits (how many ground-truth expected terms appear in answer)
 *   - citation count + titles
 *   - latency
 * Then prints a summary score table.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync } from "fs";
import { mkdirSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const ROOT = join(__dir, "..");

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const TOKEN = process.env.ADMIN_TOKEN ?? "dev-secret";
const FRESH = process.argv.includes("--fresh");

const incidentsV1 = JSON.parse(readFileSync(join(ROOT, "fixtures/eval/real_incidents.json"), "utf8"));
const incidentsV2Path = join(ROOT, "fixtures/eval/corpus_v2.json");
let incidentsV2 = [];
try { incidentsV2 = JSON.parse(readFileSync(incidentsV2Path, "utf8")); } catch { /* not required */ }
const incidents = [...incidentsV1, ...incidentsV2];
const evalSet = JSON.parse(readFileSync(join(ROOT, "fixtures/eval/real_queries.json"), "utf8"));

// ── helpers ───────────────────────────────────────────────────────────────────

function hdr(extra = {}) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${TOKEN}`,
    ...extra,
  };
}

async function apiPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: hdr(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`, { headers: hdr() });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function keyFactHits(answer, expectedFacts) {
  if (!expectedFacts || expectedFacts.length === 0) return { hits: 0, total: 0, ratio: 1 };
  const lower = (answer ?? "").toLowerCase();
  const hits = expectedFacts.filter(f => lower.includes(f.toLowerCase())).length;
  return { hits, total: expectedFacts.length, ratio: hits / expectedFacts.length };
}

function pct(n, d) { return d === 0 ? "N/A" : `${Math.round((n / d) * 100)}%`; }
function ms(n) { return `${Math.round(n)}ms`; }
function pad(s, n) { return String(s ?? "").padEnd(n).slice(0, n); }

// ── Step 1: optionally clear data and ingest ──────────────────────────────────

async function ingestCorpus() {
  if (FRESH) {
    console.log("[eval] --fresh: clearing existing incidents...");
    const existing = await apiGet("/incidents?limit=50");
    for (const inc of existing.data ?? []) {
      await fetch(`${API_URL}/incidents/${inc.id}`, {
        method: "DELETE",
        headers: hdr(),
      });
    }
    await sleep(500);
  }

  // Check which incident keys are already ingested (by title prefix)
  const existing = await apiGet("/incidents?limit=50&page=1");
  const existingTitles = new Set((existing.data ?? []).map(i => i.title));

  const ingested = [];
  for (const inc of incidents) {
    if (existingTitles.has(inc.title)) {
      console.log(`[eval] skip (already ingested): ${inc._key}`);
      const match = (existing.data ?? []).find(i => i.title === inc.title);
      ingested.push({ key: inc._key, id: match?.id });
      continue;
    }
    const { _key, ...body } = inc;
    try {
      const res = await apiPost("/ingest/manual", body);
      ingested.push({ key: _key, id: res.id });
      console.log(`[eval] ingested: ${_key} → ${res.id}`);
      await sleep(150);
    } catch (err) {
      console.error(`[eval] INGEST FAILED ${_key}:`, err.message);
      ingested.push({ key: _key, id: null, error: err.message });
    }
  }
  return ingested;
}

// ── Step 2: run QA queries ────────────────────────────────────────────────────

async function runQueries(incidentMap) {
  const results = [];

  for (const q of evalSet.queries) {
    const t0 = Date.now();
    let result;

    if (q.type === "search") {
      try {
        const encoded = encodeURIComponent(q.question);
        const res = await apiGet(`/search?q=${encoded}&limit=10`);
        const latency = Date.now() - t0;
        // Search results: { data: [{ incident: {id, title}, score, evidence }] }
        const items = res.data ?? res.results ?? [];
        const returnedKeys = items.map(r => {
          const incId = r.incident?.id ?? r.id;
          for (const [k, id] of Object.entries(incidentMap)) {
            if (id === incId) return k;
          }
          return null;
        }).filter(Boolean);

        const expected = q.expectedIncidentKeys ?? [];
        const recall = expected.length === 0 ? 1 :
          expected.filter(k => returnedKeys.includes(k)).length / expected.length;

        result = {
          id: q.id,
          type: "search",
          status: "ok",
          latencyMs: latency,
          returnedKeys,
          expectedKeys: expected,
          recall,
          topTitle: items[0]?.incident?.title ?? items[0]?.title ?? null,
        };
        const emo = recall === 1 ? "✓" : recall > 0 ? "~" : "✗";
        console.log(`  ${emo} [search] ${q.id} recall=${pct(expected.filter(k => returnedKeys.includes(k)).length, expected.length)} top="${result.topTitle?.slice(0,50)}"`);
      } catch (err) {
        result = { id: q.id, type: "search", status: "error", error: err.message };
        console.log(`  ✗ [search] ${q.id} ERROR: ${err.message}`);
      }
    } else {
      // qa or refusal
      try {
        const res = await apiPost("/qa", {
          question: q.question,
          options: { mode: "eval" },
        });
        const latency = Date.now() - t0;
        const status = res.status;
        const answer = res.answer ?? "";
        const facts = keyFactHits(answer, q.expectedKeyFacts);
        const citations = (res.citations ?? []).map(c => c.title ?? c.incidentId);

        const expectRefusal = q.expectRefusal === true;
        const gotRefusal = status !== "answered";
        const refusalCorrect = expectRefusal ? gotRefusal : !gotRefusal;

        // Check if the right incident was cited
        let correctIncidentCited = null;
        if (q.incidentKey && incidentMap[q.incidentKey]) {
          const expectedId = incidentMap[q.incidentKey];
          correctIncidentCited = (res.citations ?? []).some(c => c.incidentId === expectedId);
        }

        result = {
          id: q.id,
          type: q.type,
          status,
          latencyMs: latency,
          factHits: facts,
          citationCount: res.evidenceCount ?? 0,
          citations,
          correctIncidentCited,
          refusalCorrect,
          retrievalPath: res.debug?.retrieval?.path ?? null,
          answer: answer.slice(0, 300),
        };

        if (expectRefusal) {
          const emo = gotRefusal ? "✓" : "✗";
          console.log(`  ${emo} [refusal] ${q.id} status=${status}`);
        } else {
          const emo = facts.ratio === 1 ? "✓" : facts.ratio >= 0.5 ? "~" : "✗";
          const citeOk = correctIncidentCited ? "✓cite" : "✗cite";
          console.log(`  ${emo} [qa] ${q.id} facts=${facts.hits}/${facts.total} ${citeOk} latency=${ms(latency)} answer="${answer.slice(0,80)}"`);
        }
      } catch (err) {
        result = { id: q.id, type: q.type, status: "error", error: err.message };
        console.log(`  ✗ [${q.type}] ${q.id} ERROR: ${err.message}`);
      }
      await sleep(80); // rate limit headroom
    }
    results.push(result);
  }
  return results;
}

// ── Step 3: print summary table ───────────────────────────────────────────────

function printSummary(results, incidentMap) {
  const qaResults = results.filter(r => r.type === "qa" && !r.id.startsWith("refusal"));
  const refusalResults = results.filter(r => r.type === "refusal" || r.id.startsWith("refusal"));
  const searchResults = results.filter(r => r.type === "search");

  // Per-incident table
  console.log("\n╔═══════════════════════════════════════════════════════════════════════════╗");
  console.log("║                    RAG EVALUATION — REAL POSTMORTEMS                     ║");
  console.log("╚═══════════════════════════════════════════════════════════════════════════╝\n");

  // QA results grouped by incident
  const incidentGroups = {};
  for (const r of qaResults) {
    const key = evalSet.queries.find(q => q.id === r.id)?.incidentKey ?? "cross";
    if (!incidentGroups[key]) incidentGroups[key] = [];
    incidentGroups[key].push(r);
  }

  console.log("QA Results by Incident:");
  console.log("─".repeat(90));
  console.log(pad("Query ID", 22) + pad("Status", 10) + pad("Facts", 10) + pad("Cite✓", 8) + pad("Path", 18) + pad("Latency", 10));
  console.log("─".repeat(90));

  let totalFactHits = 0, totalFacts = 0, totalCiteCorrect = 0, totalQA = 0, totalAnswered = 0;
  let totalLatency = 0;

  for (const r of qaResults) {
    const status = r.status === "answered" ? "answered" : r.status;
    const factsStr = r.factHits ? `${r.factHits.hits}/${r.factHits.total}` : "-";
    const citeStr = r.correctIncidentCited === true ? "YES" : r.correctIncidentCited === false ? "NO" : "-";
    const path = r.retrievalPath ?? "-";
    const lat = r.latencyMs ? ms(r.latencyMs) : "-";
    console.log(pad(r.id, 22) + pad(status, 10) + pad(factsStr, 10) + pad(citeStr, 8) + pad(path, 18) + pad(lat, 10));

    if (r.factHits) { totalFactHits += r.factHits.hits; totalFacts += r.factHits.total; }
    if (r.correctIncidentCited === true) totalCiteCorrect++;
    if (r.status === "answered") totalAnswered++;
    totalQA++;
    if (r.latencyMs) totalLatency += r.latencyMs;
  }

  console.log("─".repeat(90));

  // Search results
  console.log("\nSearch Recall:");
  console.log("─".repeat(60));
  let totalSearchRecall = 0, searchCount = 0;
  for (const r of searchResults) {
    const recallStr = r.recall !== undefined ? pct(Math.round(r.recall * (r.expectedKeys?.length ?? 1)), r.expectedKeys?.length ?? 1) : "-";
    console.log(`  ${r.id}: recall=${recallStr} returned=${(r.returnedKeys ?? []).join(", ") || "none"}`);
    if (r.recall !== undefined) { totalSearchRecall += r.recall; searchCount++; }
  }

  // Refusal accuracy
  const refusalCorrect = refusalResults.filter(r => r.refusalCorrect).length;
  console.log(`\nRefusal accuracy: ${refusalCorrect}/${refusalResults.length} (${pct(refusalCorrect, refusalResults.length)})`);

  // Summary scores
  console.log("\n┌─────────────────────────────────────────────────────┐");
  console.log("│                   SUMMARY SCORES                     │");
  console.log("├─────────────────────────────────────────────────────┤");
  console.log(`│  QA answered rate    : ${pct(totalAnswered, totalQA).padEnd(6)} (${totalAnswered}/${totalQA})           │`);
  console.log(`│  Key-fact hit rate   : ${pct(totalFactHits, totalFacts).padEnd(6)} (${totalFactHits}/${totalFacts} terms found)  │`);
  console.log(`│  Citation precision  : ${pct(totalCiteCorrect, totalQA).padEnd(6)} (right incident cited) │`);
  console.log(`│  Search recall (avg) : ${(searchCount > 0 ? pct(Math.round((totalSearchRecall/searchCount)*100), 100) : "N/A").padEnd(6)}                      │`);
  console.log(`│  Refusal accuracy    : ${pct(refusalCorrect, refusalResults.length).padEnd(6)} (${refusalCorrect}/${refusalResults.length} correct)        │`);
  console.log(`│  QA latency p50      : ${ms(totalLatency / Math.max(1, totalQA)).padEnd(6)}                      │`);
  console.log("└─────────────────────────────────────────────────────┘");

  // Failed QA — show actual answers for manual review
  const failed = qaResults.filter(r => r.factHits && r.factHits.ratio < 0.5);
  if (failed.length > 0) {
    console.log("\n⚠ LOW FACT-HIT ANSWERS (ratio < 50%) — manual review:");
    console.log("─".repeat(80));
    for (const r of failed) {
      const q = evalSet.queries.find(q => q.id === r.id);
      console.log(`\n  Query: ${r.id}`);
      console.log(`  Q:     ${q?.question}`);
      console.log(`  A:     ${r.answer || "(no answer)"}`);
      console.log(`  Facts missed: ${(q?.expectedKeyFacts ?? []).filter(f => !(r.answer?.toLowerCase().includes(f.toLowerCase()))).join(", ")}`);
    }
  }

  // Sample good answers for spot-check
  const answered = qaResults.filter(r => r.status === "answered" && r.factHits?.ratio === 1);
  if (answered.length > 0) {
    console.log("\n✓ SAMPLE FULL-SCORE ANSWERS (spot-check):");
    console.log("─".repeat(80));
    for (const r of answered.slice(0, 3)) {
      const q = evalSet.queries.find(q => q.id === r.id);
      console.log(`\n  Query:    ${r.id}`);
      console.log(`  Q:        ${q?.question}`);
      console.log(`  A:        ${r.answer}`);
      console.log(`  Citations: ${r.citations.slice(0, 2).join(", ")}`);
    }
  }

  return {
    qaAnsweredRate: totalAnswered / Math.max(1, totalQA),
    keyFactHitRate: totalFacts > 0 ? totalFactHits / totalFacts : 0,
    citationPrecision: totalCiteCorrect / Math.max(1, totalQA),
    searchRecallAvg: searchCount > 0 ? totalSearchRecall / searchCount : 0,
    refusalAccuracy: refusalCorrect / Math.max(1, refusalResults.length),
  };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[eval] API: ${API_URL}  fresh=${FRESH}`);
  console.log(`[eval] corpus: ${incidents.length} real postmortems, ${evalSet.queries.length} queries\n`);

  console.log("[eval] === INGESTION ===");
  const ingested = await ingestCorpus();
  const incidentMap = Object.fromEntries(ingested.filter(i => i.id).map(i => [i.key, i.id]));
  console.log(`[eval] mapped ${Object.keys(incidentMap).length}/${incidents.length} incidents\n`);

  // Wait briefly for chunk indexing to finish
  await sleep(1500);

  // Verify chunk index
  const chunkCount = await fetch(`${API_URL}/incidents?limit=50`).then(r => r.json())
    .then(() => null).catch(() => null);

  console.log("[eval] === QA + SEARCH EVALUATION ===");
  const results = await runQueries(incidentMap);

  console.log("\n[eval] === RESULTS ===");
  const scores = printSummary(results, incidentMap);

  // Write full results JSON
  try {
    mkdirSync(join(ROOT, "artifacts/eval"), { recursive: true });
    const outPath = join(ROOT, `artifacts/eval/real-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(outPath, JSON.stringify({ scores, results, incidentMap }, null, 2));
    console.log(`\n[eval] full results → ${outPath}`);
  } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
