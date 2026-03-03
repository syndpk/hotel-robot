/**
 * concierge_search tool — exposes the ConciergeIndex to the agent loop.
 *
 * The agent calls this tool when it needs local knowledge about Athens:
 * restaurants, sightseeing, activities, day plans, etc.
 */
import { z } from 'zod';
export declare const ConciergeSearchSchema: z.ZodObject<{
    query: z.ZodString;
    topK: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    query: string;
    topK?: number | undefined;
}, {
    query: string;
    topK?: number | undefined;
}>;
export type ConciergeSearchArgs = z.infer<typeof ConciergeSearchSchema>;
export declare function searchConcierge(args: ConciergeSearchArgs): Promise<unknown>;
