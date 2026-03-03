/**
 * Agent loop — model-first with deterministic verification.
 *
 * Each iteration:
 *   1. Build messages (system prompt + history + tool results so far).
 *   2. Ask the LLM for a Proposal: {assistant_message, proposed_actions[], confidence}.
 *   3. Run the deterministic Verifier against the Proposal.
 *      - PASS  → proceed to execute any tool_calls.
 *      - FAIL (correctable, ≤ MAX_CORRECTIONS) → append correction prompt, retry LLM.
 *      - FAIL (fatal or exhausted retries) → HANDOFF.
 *   4. Execute each tool_call in the approved Proposal sequentially.
 *   5. Feed results back into context; loop continues until:
 *      - No tool_calls remain in the Proposal, OR
 *      - A handoff action is present, OR
 *      - MAX_STEPS reached.
 *
 * Returns the final assistant_message to deliver to the guest.
 */
import { AgentContext, Session, TraceStep } from './types';
export interface AgentLoopOptions {
    /** Called for each trace step — use to stream to SSE clients. */
    onTrace: (step: TraceStep) => void;
}
export declare function runAgentLoop(context: AgentContext, session: Session, userMessage: string, opts: AgentLoopOptions): Promise<string>;
