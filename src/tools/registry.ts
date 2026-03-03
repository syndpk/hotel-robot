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

import { z } from 'zod';
import {
  GetQuoteSchema, BookTaxiSchema,
  getTaxiQuote, bookTaxi,
} from './taxiSim';
import {
  FindReservationSchema, CheckInSchema, CheckOutSchema,
  CheckAvailabilitySchema, CreateReservationSchema,
  findReservation, checkIn, checkOut,
  checkAvailability, createReservation,
} from './pmsSim';
import { ConciergeSearchSchema, searchConcierge } from './conciergeSearch';
import { sessionStore } from '../core/sessionStore';
import type { IdentitySlot } from '../core/types';

// ── Tool definition type ───────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodObject<any>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

// ── Registry ───────────────────────────────────────────────────────────────────

export const TOOLS: ToolDefinition[] = [
  // ── Taxi ──
  {
    name: 'get_taxi_quote',
    description:
      'Get a price quote for a taxi from one location to another. Must be called before book_taxi.',
    schema: GetQuoteSchema,
    execute: (args) => getTaxiQuote(GetQuoteSchema.parse(args)),
  },
  {
    name: 'book_taxi',
    description:
      'Book a confirmed taxi using a valid quoteId. Requires prior explicit guest confirmation.',
    schema: BookTaxiSchema,
    execute: (args) => bookTaxi(BookTaxiSchema.parse(args)),
  },

  // ── PMS ──
  {
    name: 'find_reservation',
    description:
      "Search the hotel PMS for a guest's reservation by name and optional confirmation code.",
    schema: FindReservationSchema,
    execute: (args) => findReservation(FindReservationSchema.parse(args)),
  },
  {
    name: 'check_in',
    description:
      'Check in a guest to their room. Requires reservationId from find_reservation and idVerified=true.',
    schema: CheckInSchema,
    execute: (args) => checkIn(CheckInSchema.parse(args)),
  },
  {
    name: 'check_out',
    description:
      'Check out a guest. Requires reservationId and prior explicit guest confirmation.',
    schema: CheckOutSchema,
    execute: (args) => checkOut(CheckOutSchema.parse(args)),
  },
  {
    name: 'check_availability',
    description:
      'Check available room types and prices for given dates. Use for walk-in guests or availability enquiries. Call before create_reservation.',
    schema: CheckAvailabilitySchema,
    execute: (args) => checkAvailability(CheckAvailabilitySchema.parse(args)),
  },
  {
    name: 'create_reservation',
    description:
      'Create a new walk-in reservation after check_availability confirms the room is available and the guest agrees to the price.',
    schema: CreateReservationSchema,
    execute: (args) => createReservation(CreateReservationSchema.parse(args)),
  },

  // ── Concierge ──
  {
    name: 'search_concierge',
    description:
      'Search the hotel concierge knowledge base for local recommendations, day plans, and activities.',
    schema: ConciergeSearchSchema,
    execute: (args) => searchConcierge(ConciergeSearchSchema.parse(args)),
  },

  // ── Identity / Document ──
  {
    name: 'document.extract',
    description:
      "Read identity document data captured from the guest's passport or ID card scan. " +
      'Returns masked fields only (document number is redacted). ' +
      'Only available after the guest has used the 🪪 ID Scan button in the UI and confirmed the details. ' +
      'Use this before check_in to confirm idVerified=true.',
    schema: z.object({
      sessionId: z.string().describe('The current session ID — copy the value from ## SESSION CONTEXT in the system prompt.'),
    }),
    execute: async (args) => {
      const { sessionId } = args as { sessionId: string };
      const session = sessionStore.getSession(sessionId);
      if (!session) return { available: false, error: 'Session not found.' };

      const identity = session.slots['identity'] as IdentitySlot | undefined;
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

const toolMap = new Map<string, ToolDefinition>(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition | undefined {
  return toolMap.get(name);
}

/**
 * Execute a tool by name with raw (unvalidated) args.
 * Throws ZodError if args are invalid — caller should catch and record as VALIDATION_ERROR.
 */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
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
export function buildToolSchemasText(): string {
  return TOOLS.map((t) => {
    const shape = t.schema.shape as Record<string, z.ZodTypeAny>;
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
