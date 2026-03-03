/**
 * Verifier — deterministic compliance checker for LLM Proposals.
 *
 * Runs AFTER the LLM produces a Proposal and BEFORE any tool is executed.
 * Returns a VerifierResult that classifies violations as:
 *
 *   correctable — retry with a correction prompt (the model can fix this)
 *   fatal       — immediate HANDOFF, no retry (policy-sensitive: billing, payments)
 *
 * Design principle: the verifier is a supervisor, not a planner.
 * It does NOT rewrite the proposal; it tells the model exactly what to fix.
 *
 * Implementation delegates slot/confirmation checks to policy.ts (TOOL_GATES),
 * which is the single source of truth for per-tool prerequisites.
 */
import { Proposal, VerifierResult } from './types';
import { Session } from './types';
/**
 * Verify a Proposal against:
 *   1. Tool existence
 *   2. Policy gates (slot completeness, confirmation requirements, billing rules)
 *   3. Basic message safety (no forbidden data collection)
 */
export declare function verifyProposal(proposal: Proposal, session: Session): VerifierResult;
/** True if any violation in the result is fatal. */
export declare function hasFatalViolation(result: VerifierResult): boolean;
/** Returns the first fatal violation's message, or a default. */
export declare function fatalReason(result: VerifierResult): string;
