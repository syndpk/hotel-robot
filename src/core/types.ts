/**
 * Core type definitions for the hotel-robot orchestration platform.
 *
 * Two output contracts exist:
 *   NextAction  — legacy 4-variant discriminated union (kept for policy.ts compat)
 *   Proposal    — new model-first contract: natural message + optional tool calls
 *
 * The active agent loop uses Proposal.  NextAction is retained because
 * policy.ts gates accept NextAction shapes to keep that module decoupled.
 */

import { z } from 'zod';

// ── NextAction ─────────────────────────────────────────────────────────────────
// The LLM must output ONLY one of these four shapes, serialised as JSON.

export const NextActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('ASK_USER'),
    /** The clarifying question to pose to the guest. */
    question: z.string(),
  }),
  z.object({
    action: z.literal('CALL_TOOL'),
    /** Exact tool name from the registry. */
    tool: z.string(),
    /** Arguments to pass; validated by the tool's own Zod schema. */
    args: z.record(z.unknown()),
  }),
  z.object({
    action: z.literal('RESPOND'),
    /** Final natural-language reply to deliver to the guest. */
    message: z.string(),
  }),
  z.object({
    action: z.literal('HANDOFF'),
    /** Reason for escalating to a human agent. */
    reason: z.string(),
  }),
]);

export type NextAction = z.infer<typeof NextActionSchema>;
export type NextActionType = NextAction['action'];

// ── Proposal (model-first output contract) ─────────────────────────────────────
// The LLM always produces a natural assistant_message plus optional actions.

export const ProposedActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tool_call'),
    /** Exact tool name from the registry. */
    tool: z.string(),
    /** Arguments; validated by the tool's own Zod schema. */
    args: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('handoff'),
    /** Why we are escalating to human staff. */
    reason: z.string(),
  }),
]);

export type ProposedAction = z.infer<typeof ProposedActionSchema>;

export const ProposalSchema = z.object({
  /** Natural-language reply to deliver to the guest. Always required. */
  assistant_message: z.string(),
  /** Tool calls or handoff to execute.  Empty array = respond-only turn. */
  proposed_actions: z.array(ProposedActionSchema).default([]),
  /** Model self-reported confidence 0..1 (informational only). */
  confidence: z.number().min(0).max(1).default(1),
});

export type Proposal = z.infer<typeof ProposalSchema>;

// ── Verifier ───────────────────────────────────────────────────────────────────

export interface VerifierViolation {
  /** Machine-readable code, e.g. 'missing_slot:contact', 'billing_dispute'. */
  code: string;
  /**
   * Human-readable message written for the LLM correction prompt.
   * Should be actionable: tell the model what to change, not just what failed.
   */
  message: string;
  /**
   * correctable → retry loop with correction prompt.
   * fatal       → immediate HANDOFF, no retry.
   */
  severity: 'correctable' | 'fatal';
}

export interface VerifierResult {
  approved: boolean;
  violations: VerifierViolation[];
}

// ── Trace ──────────────────────────────────────────────────────────────────────

export type TraceEventType =
  // Proposal-loop events
  | 'PROPOSAL'               // LLM produced a proposal
  | 'VERIFY_PASS'            // verifier approved
  | 'VERIFY_FAIL'            // verifier rejected (lists violations)
  | 'VERIFY_RETRY'           // sending correction prompt, retrying
  // Tool execution
  | 'TOOL_RESULT'            // tool executed (success or error)
  // Identity / document events
  | 'DOCUMENT_CAPTURED'      // image received by /api/passport
  | 'DOCUMENT_EXTRACTED'     // OCR + MRZ parsing completed (masked fields only)
  | 'DOCUMENT_VALIDATION'    // MRZ checksum result
  | 'DOCUMENT_CONFIRMATION'  // guest confirmed extracted fields
  // Diagnostic
  | 'LLM_CONTEXT_SUMMARY'   // snapshot of context injected into each LLM call
  // Outcomes
  | 'HANDOFF'                // escalating to human staff
  | 'PARSE_ERROR'            // couldn't extract valid JSON
  | 'ERROR'                  // LLM/system error
  | 'START'                  // run started
  | 'FINISH';                // run finished

export interface TraceStep {
  stepIndex: number;
  timestamp: string;       // ISO-8601
  event: TraceEventType;
  details: unknown;
  durationMs?: number;
}

// ── Chat message ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ── Identity / document capture ────────────────────────────────────────────────

/** Stored in session.slots.identity after a successful /api/passport call. */
export interface IdentitySlot {
  /** Masked fields safe for LLM context and trace logging. */
  maskedFields: {
    fullName?:        string;
    surname?:         string;
    givenNames?:      string;
    nationality?:     string;
    dateOfBirth?:     string;   // YYYY-MM-DD
    /** Masked document number: "A***456" */
    documentNumber?:  string;
    /** Last-2 fingerprint of document number for desk quick-check: "****XY" */
    mrzMaskedLast6?:  string;
    expiryDate?:      string;   // YYYY-MM-DD
    issuingCountry?:  string;
    documentType?:    string;
    sex?:             string;
  };
  validationStatus: {
    mrzFound:           boolean;
    mrzFormat:          string;
    mrzChecksumPassed:  boolean;
    failedChecksums:    string[];
    errors:             string[];
  };
  confidences: {
    overall: number;           // 0..1
  };
  /** Convenience alias for validationStatus.mrzChecksumPassed. */
  checksumValid: boolean;
  /** True once the guest explicitly confirmed the extracted details via the UI. */
  confirmedByUser: boolean;
  capturedAt: string;          // ISO timestamp
}

// ── Session ────────────────────────────────────────────────────────────────────

export interface Session {
  sessionId: string;
  /** Full conversation history (user + assistant turns). */
  history: ChatMessage[];
  /** Slot values accumulated across turns (e.g. guestName, reservationId). */
  slots: Record<string, unknown>;
  /** Most recent tool output; carried into the next turn's context. */
  lastToolOutput?: unknown;
  lastBookingId?: string;
  lastReservationId?: string;
  /** How many times find_reservation has returned no results this session. */
  reservationNotFoundCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Run ────────────────────────────────────────────────────────────────────────

export type RunStatus = 'pending' | 'running' | 'done' | 'error';

export interface Run {
  runId: string;
  sessionId: string;
  status: RunStatus;
  /** Raw text input (either user-typed or STT transcript). */
  input: string;
  /** Final agent response text. */
  output?: string;
  /** Base-64 encoded MP3 from ElevenLabs TTS (present when voice was used). */
  audioOutputBase64?: string;
  trace: TraceStep[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

// ── Agent context (assembled per-run) ─────────────────────────────────────────

export interface AgentContext {
  hotelConfig: HotelConfig;
  selectedSkills: SkillDoc[];
  conciergeSnippets: ConciergeSnippet[];
  history: ChatMessage[];
  slots: Record<string, unknown>;
  /** Session ID — injected into system prompt so agent can pass it to document.extract. */
  sessionId: string;
}

export interface HotelConfig {
  name: string;
  city: string;
  address: string;
  phone: string;
  checkInTime: string;
  checkOutTime: string;
  policies: Record<string, unknown>;
}

export interface SkillDoc {
  name: string;
  content: string;
}

export interface ConciergeSnippet {
  sourceId: string;
  text: string;
  score: number;
}

// ── Step record (within a single run) ─────────────────────────────────────────

export interface StepRecord {
  action: NextAction;
  toolResult?: unknown;
  toolError?: string;
}
