/**
 * concierge_search tool — exposes the ConciergeIndex to the agent loop.
 *
 * The agent calls this tool when it needs local knowledge about Athens:
 * restaurants, sightseeing, activities, day plans, etc.
 */

import { z } from 'zod';
import { getConciergeIndex } from '../core/rag/conciergeIndex';

export const ConciergeSearchSchema = z.object({
  query: z
    .string()
    .describe(
      'Natural language search query, e.g. "rainy day museums", "family beach Athens", "one day sightseeing itinerary"',
    ),
  topK: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('Maximum number of results to return (default: 3)'),
});

export type ConciergeSearchArgs = z.infer<typeof ConciergeSearchSchema>;

export async function searchConcierge(args: ConciergeSearchArgs): Promise<unknown> {
  const { query, topK = 3 } = args;
  const index = getConciergeIndex();
  const results = index.search(query, topK);

  if (results.length === 0) {
    return {
      results: [],
      message:
        'No matching concierge information found. You may refer the guest to the front desk for specialist advice.',
    };
  }

  return {
    results: results.map((r) => ({
      sourceId: r.sourceId,
      relevanceScore: r.score,
      excerpt: r.text,
    })),
  };
}
