# Ingestion Pipeline

## Stages
1. Fetch (crawl or upload)
2. Parse (HTML/PDF/MD to text; store raw + extracted)
3. Extract fields (title/date/company/impact/timeline/root cause/fix)
4. Sectioning (impact/timeline/rootcause/fix sections)
5. Chunking + Embeddings (summary + key sections)
6. Indexing (FTS + vector)
7. Graph extraction (entities + edges with evidence pointers)
8. Persist job status + artifacts

## Reliability patterns
- Retry/backoff per stage
- Store partial artifacts even on failure
- Modular source adapters
- Manual correction workflow for key fields
