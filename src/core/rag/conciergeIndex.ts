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

import * as fs from 'fs';
import * as path from 'path';
import { ConciergeSnippet } from '../types';

const DOCS_DIR = path.resolve(__dirname, '..', '..', 'concierge_docs');
const SNIPPET_MAX_CHARS = 600;

interface IndexedDoc {
  sourceId: string;
  title: string;
  snippets: string[];   // paragraphs
  rawText: string;
}

// ── Text helpers ───────────────────────────────────────────────────────────────

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function scoreSnippet(snippet: string, queryTokens: string[]): number {
  const snippetTokens = tokenise(snippet);
  const freq = new Map<string, number>();
  for (const t of snippetTokens) freq.set(t, (freq.get(t) ?? 0) + 1);

  let score = 0;
  for (const qt of queryTokens) {
    score += freq.get(qt) ?? 0;
    // Boost partial matches (e.g. "museum" matches "museums")
    for (const [tok, cnt] of freq) {
      if (tok.startsWith(qt) && tok !== qt) score += cnt * 0.4;
    }
  }
  return score;
}

// ── Index ──────────────────────────────────────────────────────────────────────

export class ConciergeIndex {
  private docs: IndexedDoc[] = [];

  private constructor(docs: IndexedDoc[]) {
    this.docs = docs;
  }

  /** Load and parse all markdown docs from the concierge_docs directory. */
  static load(): ConciergeIndex {
    const docs: IndexedDoc[] = [];

    if (!fs.existsSync(DOCS_DIR)) {
      console.warn('[ConciergeIndex] concierge_docs directory not found at', DOCS_DIR);
      return new ConciergeIndex([]);
    }

    const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const raw = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8');

      // Extract frontmatter id/title if present
      const idMatch = raw.match(/^id:\s*(.+)$/m);
      const titleMatch = raw.match(/^title:\s*(.+)$/m);
      const sourceId = idMatch ? idMatch[1].trim() : path.basename(file, '.md');
      const title = titleMatch ? titleMatch[1].trim() : sourceId;

      // Split into paragraphs (blank-line separated)
      const snippets = raw
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter((s) => s.length > 40 && !s.startsWith('---'));

      docs.push({ sourceId, title, snippets, rawText: raw });
    }

    return new ConciergeIndex(docs);
  }

  /**
   * Search the index and return the top-k most relevant snippets.
   * Each snippet is trimmed to SNIPPET_MAX_CHARS for prompt economy.
   */
  search(query: string, topK = 3): ConciergeSnippet[] {
    if (!query.trim() || this.docs.length === 0) return [];

    const queryTokens = tokenise(query);

    const candidates: { sourceId: string; text: string; score: number }[] = [];

    for (const doc of this.docs) {
      for (const snippet of doc.snippets) {
        const score = scoreSnippet(snippet, queryTokens);
        if (score > 0) {
          candidates.push({
            sourceId: doc.sourceId,
            text: snippet.slice(0, SNIPPET_MAX_CHARS),
            score,
          });
        }
      }
    }

    // Sort descending, deduplicate by sourceId (keep best per doc)
    const seen = new Set<string>();
    return candidates
      .sort((a, b) => b.score - a.score)
      .filter((c) => {
        if (seen.has(c.sourceId)) return false;
        seen.add(c.sourceId);
        return true;
      })
      .slice(0, topK);
  }
}

// ── Singleton (loaded once at startup) ────────────────────────────────────────

let _index: ConciergeIndex | null = null;

export function getConciergeIndex(): ConciergeIndex {
  if (!_index) _index = ConciergeIndex.load();
  return _index;
}
