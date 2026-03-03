"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProposalSchema = exports.ProposedActionSchema = exports.NextActionSchema = void 0;
const zod_1 = require("zod");
// ── NextAction ─────────────────────────────────────────────────────────────────
// The LLM must output ONLY one of these four shapes, serialised as JSON.
exports.NextActionSchema = zod_1.z.discriminatedUnion('action', [
    zod_1.z.object({
        action: zod_1.z.literal('ASK_USER'),
        /** The clarifying question to pose to the guest. */
        question: zod_1.z.string(),
    }),
    zod_1.z.object({
        action: zod_1.z.literal('CALL_TOOL'),
        /** Exact tool name from the registry. */
        tool: zod_1.z.string(),
        /** Arguments to pass; validated by the tool's own Zod schema. */
        args: zod_1.z.record(zod_1.z.unknown()),
    }),
    zod_1.z.object({
        action: zod_1.z.literal('RESPOND'),
        /** Final natural-language reply to deliver to the guest. */
        message: zod_1.z.string(),
    }),
    zod_1.z.object({
        action: zod_1.z.literal('HANDOFF'),
        /** Reason for escalating to a human agent. */
        reason: zod_1.z.string(),
    }),
]);
// ── Proposal (model-first output contract) ─────────────────────────────────────
// The LLM always produces a natural assistant_message plus optional actions.
exports.ProposedActionSchema = zod_1.z.discriminatedUnion('type', [
    zod_1.z.object({
        type: zod_1.z.literal('tool_call'),
        /** Exact tool name from the registry. */
        tool: zod_1.z.string(),
        /** Arguments; validated by the tool's own Zod schema. */
        args: zod_1.z.record(zod_1.z.unknown()),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('handoff'),
        /** Why we are escalating to human staff. */
        reason: zod_1.z.string(),
    }),
]);
exports.ProposalSchema = zod_1.z.object({
    /** Natural-language reply to deliver to the guest. Always required. */
    assistant_message: zod_1.z.string(),
    /** Tool calls or handoff to execute.  Empty array = respond-only turn. */
    proposed_actions: zod_1.z.array(exports.ProposedActionSchema).default([]),
    /** Model self-reported confidence 0..1 (informational only). */
    confidence: zod_1.z.number().min(0).max(1).default(1),
});
//# sourceMappingURL=types.js.map