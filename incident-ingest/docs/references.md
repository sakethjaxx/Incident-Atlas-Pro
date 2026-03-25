# References & Model Choices

## Embedding Models (Retrieval)

| Model | Provider | Context | Dimensions | Cost / 1M Tokens | Justification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`text-embedding-3-small`** | OpenAI | 8191 | 1536 (variable) | $0.02 | **Primary Choice.** Best price/performance for MVP. Supports Matryoshka for storage optimization. |
| **`bge-m3`** | BAAI | 8192 | 1024 | $0 (Self-hosted) | **Open-source fallback.** Supports hybrid search natively. |

## Reranking Models (Precision)

| Model | Provider | Context | Language | Justification |
| :--- | :--- | :--- | :--- | :--- |
| **`rerank-english-v3.0`** | Cohere | 4096 | English | **Primary Choice.** Industry standard for precision. Excellent integration with RAG stacks. |
| **`bge-reranker-v2-m3`** | BAAI | 8192 | Multilingual | **Open-source fallback.** High performance on MTEB benchmarks. |

## Documentation Links
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings)
- [Cohere Rerank](https://docs.cohere.com/docs/rerank-overview)
- [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard)

**Updated:** 2026-03-07

- Title
- Link
- Why it matters
