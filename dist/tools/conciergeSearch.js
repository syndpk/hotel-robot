"use strict";
/**
 * concierge_search tool — exposes the ConciergeIndex to the agent loop.
 *
 * The agent calls this tool when it needs local knowledge about Athens:
 * restaurants, sightseeing, activities, day plans, etc.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConciergeSearchSchema = void 0;
exports.searchConcierge = searchConcierge;
const zod_1 = require("zod");
const conciergeIndex_1 = require("../core/rag/conciergeIndex");
exports.ConciergeSearchSchema = zod_1.z.object({
    query: zod_1.z
        .string()
        .describe('Natural language search query, e.g. "rainy day museums", "family beach Athens", "one day sightseeing itinerary"'),
    topK: zod_1.z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe('Maximum number of results to return (default: 3)'),
});
async function searchConcierge(args) {
    const { query, topK = 3 } = args;
    const index = (0, conciergeIndex_1.getConciergeIndex)();
    const results = index.search(query, topK);
    if (results.length === 0) {
        return {
            results: [],
            message: 'No matching concierge information found. You may refer the guest to the front desk for specialist advice.',
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
//# sourceMappingURL=conciergeSearch.js.map