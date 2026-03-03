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
export declare const NextActionSchema: z.ZodDiscriminatedUnion<"action", [z.ZodObject<{
    action: z.ZodLiteral<"ASK_USER">;
    /** The clarifying question to pose to the guest. */
    question: z.ZodString;
}, "strip", z.ZodTypeAny, {
    action: "ASK_USER";
    question: string;
}, {
    action: "ASK_USER";
    question: string;
}>, z.ZodObject<{
    action: z.ZodLiteral<"CALL_TOOL">;
    /** Exact tool name from the registry. */
    tool: z.ZodString;
    /** Arguments to pass; validated by the tool's own Zod schema. */
    args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    action: "CALL_TOOL";
    tool: string;
    args: Record<string, unknown>;
}, {
    action: "CALL_TOOL";
    tool: string;
    args: Record<string, unknown>;
}>, z.ZodObject<{
    action: z.ZodLiteral<"RESPOND">;
    /** Final natural-language reply to deliver to the guest. */
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    action: "RESPOND";
    message: string;
}, {
    action: "RESPOND";
    message: string;
}>, z.ZodObject<{
    action: z.ZodLiteral<"HANDOFF">;
    /** Reason for escalating to a human agent. */
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    action: "HANDOFF";
    reason: string;
}, {
    action: "HANDOFF";
    reason: string;
}>]>;
export type NextAction = z.infer<typeof NextActionSchema>;
export type NextActionType = NextAction['action'];
export declare const ProposedActionSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"tool_call">;
    /** Exact tool name from the registry. */
    tool: z.ZodString;
    /** Arguments; validated by the tool's own Zod schema. */
    args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    type: "tool_call";
    tool: string;
    args: Record<string, unknown>;
}, {
    type: "tool_call";
    tool: string;
    args: Record<string, unknown>;
}>, z.ZodObject<{
    type: z.ZodLiteral<"handoff">;
    /** Why we are escalating to human staff. */
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "handoff";
    reason: string;
}, {
    type: "handoff";
    reason: string;
}>]>;
export type ProposedAction = z.infer<typeof ProposedActionSchema>;
export declare const ProposalSchema: z.ZodObject<{
    /** Natural-language reply to deliver to the guest. Always required. */
    assistant_message: z.ZodString;
    /** Tool calls or handoff to execute.  Empty array = respond-only turn. */
    proposed_actions: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"tool_call">;
        /** Exact tool name from the registry. */
        tool: z.ZodString;
        /** Arguments; validated by the tool's own Zod schema. */
        args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        type: "tool_call";
        tool: string;
        args: Record<string, unknown>;
    }, {
        type: "tool_call";
        tool: string;
        args: Record<string, unknown>;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"handoff">;
        /** Why we are escalating to human staff. */
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "handoff";
        reason: string;
    }, {
        type: "handoff";
        reason: string;
    }>]>, "many">>;
    /** Model self-reported confidence 0..1 (informational only). */
    confidence: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    assistant_message: string;
    proposed_actions: ({
        type: "tool_call";
        tool: string;
        args: Record<string, unknown>;
    } | {
        type: "handoff";
        reason: string;
    })[];
    confidence: number;
}, {
    assistant_message: string;
    proposed_actions?: ({
        type: "tool_call";
        tool: string;
        args: Record<string, unknown>;
    } | {
        type: "handoff";
        reason: string;
    })[] | undefined;
    confidence?: number | undefined;
}>;
export type Proposal = z.infer<typeof ProposalSchema>;
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
export type TraceEventType = 'PROPOSAL' | 'VERIFY_PASS' | 'VERIFY_FAIL' | 'VERIFY_RETRY' | 'TOOL_RESULT' | 'DOCUMENT_CAPTURED' | 'DOCUMENT_EXTRACTED' | 'DOCUMENT_VALIDATION' | 'DOCUMENT_CONFIRMATION' | 'LLM_CONTEXT_SUMMARY' | 'HANDOFF' | 'PARSE_ERROR' | 'ERROR' | 'START' | 'FINISH';
export interface TraceStep {
    stepIndex: number;
    timestamp: string;
    event: TraceEventType;
    details: unknown;
    durationMs?: number;
}
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
/** Stored in session.slots.identity after a successful /api/passport call. */
export interface IdentitySlot {
    /** Masked fields safe for LLM context and trace logging. */
    maskedFields: {
        fullName?: string;
        surname?: string;
        givenNames?: string;
        nationality?: string;
        dateOfBirth?: string;
        /** Masked document number: "A***456" */
        documentNumber?: string;
        /** Last-2 fingerprint of document number for desk quick-check: "****XY" */
        mrzMaskedLast6?: string;
        expiryDate?: string;
        issuingCountry?: string;
        documentType?: string;
        sex?: string;
    };
    validationStatus: {
        mrzFound: boolean;
        mrzFormat: string;
        mrzChecksumPassed: boolean;
        failedChecksums: string[];
        errors: string[];
    };
    confidences: {
        overall: number;
    };
    /** Convenience alias for validationStatus.mrzChecksumPassed. */
    checksumValid: boolean;
    /** True once the guest explicitly confirmed the extracted details via the UI. */
    confirmedByUser: boolean;
    capturedAt: string;
}
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
export interface StepRecord {
    action: NextAction;
    toolResult?: unknown;
    toolError?: string;
}
