# Retrieval Pipeline

## Candidate recall
- Keyword search (Postgres FTS/BM25)
- Vector search (summary + key sections)

## Rerank
- Cross-encoder reranks top N candidates to top K

## Assemble
Return:
- ranked incidents
- top matching sections (evidence)
- optional graph patterns

## Optional generation (strict)
- Generate only from retrieved evidence
- Every claim must cite a section
- Refuse if evidence is insufficient
