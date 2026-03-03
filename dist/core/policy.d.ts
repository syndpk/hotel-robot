/**
 * Policy gates — safety and confirmation rules applied before the agent
 * executes potentially irreversible or high-impact tool calls.
 *
 * Rules enforced here (HARD — cannot be overridden by prompting):
 *  1. book_taxi  — requires explicit guest confirmation.
 *  2. check_out  — requires explicit guest confirmation.
 *  3. create_reservation — multi-stage slot gate:
 *       (a) guestName must contain first + last name.
 *       (b) contact (phone or email) must be present.
 *       (c) booking summary shown and confirmed by guest before execution.
 *  4. find_reservation — HANDOFF after 2 consecutive misses.
 *  5. Billing keywords in last user message → immediate HANDOFF.
 */
import { NextAction, Session } from './types';
export interface PolicyResult {
    /** Block execution and return confirmationQuestion to the guest. */
    requiresConfirmation: boolean;
    confirmationQuestion?: string;
    /** Immediately HANDOFF instead of executing the tool. */
    mustHandoff: boolean;
    handoffReason?: string;
    /**
     * Machine-readable reason code for trace observability.
     * Examples: 'missing_slot:guestFullName', 'missing_slot:contact',
     *           'booking_confirmation', 'billing_dispute', 'reservation_not_found'
     */
    gateReason?: string;
}
/**
 * Evaluate whether a CALL_TOOL action should be blocked.
 * Call this BEFORE executing the tool.
 */
export declare function checkPolicy(action: NextAction, session: Session): PolicyResult;
/**
 * Update session state after a find_reservation result.
 * Tracks consecutive "not found" responses to trigger HANDOFF threshold.
 */
export declare function trackReservationResult(session: Session, result: unknown): void;
