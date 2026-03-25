# Evaluation Plan

## Dataset
- Start with 30–50 queries paired with expected incident IDs.
- Grow as you ingest more sources.

## Metrics
- Recall@K (@5, @10)
- MRR
- NDCG@K (optional)

## CI gating
- Track metrics across PRs
- Fail build if recall drops beyond threshold or critical queries regress

## Artifacts
- Store metrics + config + model versions per run
- Publish an `eval_report.json`
