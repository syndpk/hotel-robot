"use strict";
/**
 * Tool registry — central catalogue of all tools available to the agent.
 *
 * Each entry defines:
 *  - name        : string key used in CALL_TOOL actions
 *  - description : shown verbatim in the LLM system prompt
 *  - schema      : Zod schema used to validate agent-supplied args
 *  - execute     : async function that runs the tool
 *
 * Adding a new tool: add one entry here and implement the handler module.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOLS = void 0;
exports.getTool = getTool;
exports.executeTool = executeTool;
exports.buildToolSchemasText = buildToolSchemasText;
const zod_1 = require("zod");
const taxiSim_1 = require("./taxiSim");
const pmsSim_1 = require("./pmsSim");
const conciergeSearch_1 = require("./conciergeSearch");
const sessionStore_1 = require("../core/sessionStore");
// ── Registry ───────────────────────────────────────────────────────────────────
exports.TOOLS = [
    // ── Taxi ──
    {
        name: 'get_taxi_quote',
        description: 'Get a price quote for a taxi from one location to another. Must be called before book_taxi.',
        schema: taxiSim_1.GetQuoteSchema,
        execute: (args) => (0, taxiSim_1.getTaxiQuote)(taxiSim_1.GetQuoteSchema.parse(args)),
    },
    {
        name: 'book_taxi',
        description: 'Book a confirmed taxi using a valid quoteId. Requires prior explicit guest confirmation.',
        schema: taxiSim_1.BookTaxiSchema,
        execute: (args) => (0, taxiSim_1.bookTaxi)(taxiSim_1.BookTaxiSchema.parse(args)),
    },
    // ── PMS ──
    {
        name: 'find_reservation',
        description: "Search the hotel PMS for a guest's reservation by name and optional confirmation code.",
        schema: pmsSim_1.FindReservationSchema,
        execute: (args) => (0, pmsSim_1.findReservation)(pmsSim_1.FindReservationSchema.parse(args)),
    },
    {
        name: 'check_in',
        description: 'Check in a guest to their room. Requires reservationId from find_reservation and idVerified=true.',
        schema: pmsSim_1.CheckInSchema,
        execute: (args) => (0, pmsSim_1.checkIn)(pmsSim_1.CheckInSchema.parse(args)),
    },
    {
        name: 'check_out',
        description: 'Check out a guest. Requires reservationId and prior explicit guest confirmation.',
        schema: pmsSim_1.CheckOutSchema,
        execute: (args) => (0, pmsSim_1.checkOut)(pmsSim_1.CheckOutSchema.parse(args)),
    },
    {
        name: 'check_availability',
        description: 'Check available room types and prices for given dates. Use for walk-in guests or availability enquiries. Call before create_reservation.',
        schema: pmsSim_1.CheckAvailabilitySchema,
        execute: (args) => (0, pmsSim_1.checkAvailability)(pmsSim_1.CheckAvailabilitySchema.parse(args)),
    },
    {
        name: 'create_reservation',
        description: 'Create a new walk-in reservation after check_availability confirms the room is available and the guest agrees to the price.',
        schema: pmsSim_1.CreateReservationSchema,
        execute: (args) => (0, pmsSim_1.createReservation)(pmsSim_1.CreateReservationSchema.parse(args)),
    },
    // ── Concierge ──
    {
        name: 'search_concierge',
        description: 'Search the hotel concierge knowledge base for local recommendations, day plans, and activities.',
        schema: conciergeSearch_1.ConciergeSearchSchema,
        execute: (args) => (0, conciergeSearch_1.searchConcierge)(conciergeSearch_1.ConciergeSearchSchema.parse(args)),
    },
    // ── Identity / Document ──
    {
        name: 'document.extract',
        description: "Read identity document data captured from the guest's passport or ID card scan. " +
            'Returns masked fields only (document number is redacted). ' +
            'Only available after the guest has used the 🪪 ID Scan button in the UI and confirmed the details. ' +
            'Use this before check_in to confirm idVerified=true.',
        schema: zod_1.z.object({
            sessionId: zod_1.z.string().describe('The current session ID — copy the value from ## SESSION CONTEXT in the system prompt.'),
        }),
        execute: async (args) => {
            const { sessionId } = args;
            const session = sessionStore_1.sessionStore.getSession(sessionId);
            if (!session)
                return { available: false, error: 'Session not found.' };
            const identity = session.slots['identity'];
            if (!identity) {
                return {
                    available: false,
                    message: 'No document has been scanned yet. Ask the guest to use the 🪪 ID Scan button.',
                };
            }
            if (!identity.confirmedByUser) {
                return {
                    available: false,
                    message: 'Document was captured but the guest has not yet confirmed the extracted details.',
                };
            }
            return {
                available: true,
                confirmedByUser: true,
                maskedFields: identity.maskedFields,
                documentType: identity.maskedFields.documentType ?? 'UNKNOWN',
                mrzValid: identity.validationStatus.mrzChecksumPassed,
                confidence: identity.confidences.overall,
                capturedAt: identity.capturedAt,
            };
        },
    },
];
// ── Lookup & dispatch ──────────────────────────────────────────────────────────
const toolMap = new Map(exports.TOOLS.map((t) => [t.name, t]));
function getTool(name) {
    return toolMap.get(name);
}
/**
 * Execute a tool by name with raw (unvalidated) args.
 * Throws ZodError if args are invalid — caller should catch and record as VALIDATION_ERROR.
 */
async function executeTool(name, args) {
    const tool = toolMap.get(name);
    if (!tool) {
        throw new Error(`Unknown tool: "${name}". Available: ${[...toolMap.keys()].join(', ')}`);
    }
    // Validate before execution
    tool.schema.parse(args);
    return tool.execute(args);
}
/**
 * Build a compact tool schema description for injection into the system prompt.
 */
function buildToolSchemasText() {
    return exports.TOOLS.map((t) => {
        const shape = t.schema.shape;
        const fields = Object.entries(shape)
            .map(([k, v]) => {
            const desc = v.description ? ` — ${v.description}` : '';
            const optional = v.isOptional() ? ' (optional)' : ' (required)';
            return `    ${k}${optional}${desc}`;
        })
            .join('\n');
        return `### ${t.name}\n${t.description}\nArgs:\n${fields}`;
    }).join('\n\n');
}
//# sourceMappingURL=registry.js.map