/**
 * Ingestion script — optional pre-processing step.
 *
 * For the keyword-based index (v0): simply validates that all documents
 * load correctly and prints a summary.
 *
 * For a future embeddings-based index: this is where you would:
 *   1. Chunk each markdown document into passages.
 *   2. Call an embeddings API (e.g. OpenAI text-embedding-3-small).
 *   3. Persist the vectors to a file (JSON or sqlite-vec) for fast lookup.
 *
 * Run:  npm run ingest
 */
export {};
