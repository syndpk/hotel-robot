/**
 * Concierge knowledge-base index.
 *
 * Strategy v0: keyword-based TF-IDF-style scoring (no embeddings required,
 * no network calls, zero latency).  Works well for short, focused queries.
 *
 * Future upgrade: replace `scoreSnippet` with cosine-similarity over
 * precomputed embeddings from `ingest.ts`.
 *
 * Usage:
 *   const index = await ConciergeIndex.load();
 *   const hits  = index.search('rainy day museum', 3);
 */
import { ConciergeSnippet } from '../types';
export declare class ConciergeIndex {
    private docs;
    private constructor();
    /** Load and parse all markdown docs from the concierge_docs directory. */
    static load(): ConciergeIndex;
    /**
     * Search the index and return the top-k most relevant snippets.
     * Each snippet is trimmed to SNIPPET_MAX_CHARS for prompt economy.
     */
    search(query: string, topK?: number): ConciergeSnippet[];
}
export declare function getConciergeIndex(): ConciergeIndex;
