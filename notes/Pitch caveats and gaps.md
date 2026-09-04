---
aliases: [Pitch caveats and gaps, Caveats, Gaps, Weaknesses, Risks]
tags: [project/incident-atlas-pro, pitch, risk]
---

# Pitch caveats and gaps

The honest weakness list for [[Incident Atlas Pro]] — what a sharp technical reviewer attacks first, ranked, with status. Reviewed 2026-07-09.

Legend: 🟢 fixed · 🟡 mitigated · 🔴 open

## The list
1. 🔴 **Key-fact hit rate 31%** — the headline hole. [[Extractive QA]] returns whole sentences but misses the *specific* fact ("how long was the outage?" → cited sentence, wrong/missing number). First thing broken in a demo. Fix = the [[Ollama]]/[[Qwen3]] path, but it's not default and not benchmarked.
2. 🟡 **Committed metrics run on the weak default** — default [[embeddings]] are a **deterministic hash**, not real semantics, so "90% answered / 88% recall" is near keyword quality. The real bge+LLM stack is unbenchmarked. Now at least *labeled* — the [[Eval harness]] stamps the stack into output.
3. 🔴 **"Compare X vs Y" underperforms** — comparison needs synthesis → needs the LLM path; extractive can only quote two disjoint snippets. And it's a *killer demo query* for "learn from past incidents."
4. 🟢 **Confidence badge undermined its own trust story** — fixed. See [[Confidence scoring]].
5. 🟡 **[[Acronym FTS gap]]** — "s3", "k8s", "OOM", "SSL" can refuse because `plainto_tsquery` ANDs every term. Acronym-heavy domain = easy demo pothole. Workaround: name the company or use an incident filter.
6. 🔴 **Corpus = 16 incidents** — a toy vs. the 100–2000-employee target. Quality/latency at thousands is unknown; no load evidence.
7. 🔴 **No real multi-tenancy** — `accessScope` + a bearer token is a *filter*, not tenant isolation / RBAC. An enterprise buyer's first security question, unanswered.
8. 🔴 **The good LLM path has no CI quality gate** — the offline-tests rule excludes [[Ollama]], so the path you'd ship to customers has no regression net.
9. 🟡 **[[Knowledge Graph]] is rules-based by default** — edge quality unmeasured; graph viz (a pitch highlight) rides heuristics.
10. 🟡 **[[TurboQuant]]** — a memory-efficiency differentiator on paper, but experimental; pitch as roadmap, not feature.

## What's actually strong (lead with these)
- **Trust**: every sentence cited or the system refuses; 100% refusal accuracy. ([[Citations-first QA]])
- **Privacy**: no third-party LLM, data never leaves the box. ([[Open-source RAG stack]])
- **Rigor**: a real [[Eval harness]] with metrics + CI gating.
- **Real corpus**: recognizable public postmortems (AWS/Monzo/Notion/GitHub).

## Priority (lazy → high value)
1. Run the **bge + [[Ollama]]/[[Qwen3]] eval** and commit *those* (labeled) numbers — turns #1/#2 from weakness into "here's the real stack." One eval run.
2. 🟢 Confidence tier — done.
3. Scripted demo that dodges the acronym / comparison potholes (or fix [[Acronym FTS gap]]).
4. Frame corpus / multi-tenancy / scale as an **honest roadmap slide** — buyers forgive "not yet," punish "surprise."

Back to [[Incident Atlas Pro]].
