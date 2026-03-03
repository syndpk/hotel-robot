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

// ── Result type ────────────────────────────────────────────────────────────────

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

const ALLOWED_POLICY: PolicyResult = { requiresConfirmation: false, mustHandoff: false };

// ── Helpers ────────────────────────────────────────────────────────────────────

function lastUserMessage(session: Session): string {
  return session.history.filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '';
}

/** True when the last user message contains an affirmative keyword. */
function lastMessageIsConfirmation(session: Session): boolean {
  return /\b(yes|yeah|yep|confirm|go ahead|proceed|ok|okay|sure)\b/i.test(
    lastUserMessage(session),
  );
}

// ── Tool gate functions ────────────────────────────────────────────────────────
// Each returns a PolicyResult to block, or null to allow through.

type ToolGateFn = (args: Record<string, unknown>, session: Session) => PolicyResult | null;

const TOOL_GATES: Record<string, ToolGateFn> = {

  // ── book_taxi ───────────────────────────────────────────────────────────────
  book_taxi: (args, session) => {
    if (lastMessageIsConfirmation(session)) return null;
    const dest  = args['dropoff'] ?? 'your destination';
    const quote = args['quoteId'] ?? '';
    return {
      requiresConfirmation: true,
      mustHandoff: false,
      confirmationQuestion:
        `Just to confirm — shall I book a taxi to ${dest} (quote ${quote})? Please say yes or no.`,
      gateReason: 'booking_confirmation',
    };
  },

  // ── check_out ───────────────────────────────────────────────────────────────
  check_out: (args, session) => {
    if (lastMessageIsConfirmation(session)) return null;
    const resId = args['reservationId'] ?? 'your reservation';
    return {
      requiresConfirmation: true,
      mustHandoff: false,
      confirmationQuestion:
        `To confirm — shall I proceed with checking out reservation ${resId}? ` +
        `This cannot be undone. Please say yes or no.`,
      gateReason: 'booking_confirmation',
    };
  },

  // ── create_reservation ──────────────────────────────────────────────────────
  // Three mandatory gates checked in strict order:
  //   (a) Full name (first + last)
  //   (b) Contact (phone or email)
  //   (c) Booking summary confirmation
  create_reservation: (args, session) => {

    // Gate (a) — full name required ─────────────────────────────────────────
    const guestName = String(args['guestName'] ?? '').trim();
    if (guestName.split(/\s+/).filter(Boolean).length < 2) {
      return {
        requiresConfirmation: true,
        mustHandoff: false,
        confirmationQuestion:
          "Could I have the guest's full name — first and last name please?",
        gateReason: 'missing_slot:guestFullName',
      };
    }

    // Gate (b) — contact required ───────────────────────────────────────────
    const contact = String(args['contact'] ?? '').trim();
    if (!contact) {
      return {
        requiresConfirmation: true,
        mustHandoff: false,
        confirmationQuestion:
          "Could I take a contact phone number or email address for the booking?",
        gateReason: 'missing_slot:contact',
      };
    }

    // Gate (c) — booking summary + guest confirmation ───────────────────────
    if (!lastMessageIsConfirmation(session)) {
      const { roomType, checkInDate, checkOutDate, guests } = args;
      return {
        requiresConfirmation: true,
        mustHandoff: false,
        confirmationQuestion:
          `Please confirm the following booking:\n` +
          `  • Guest: ${guestName}\n` +
          `  • Room: ${roomType}\n` +
          `  • Check-in: ${checkInDate}  →  Check-out: ${checkOutDate}\n` +
          `  • Guests: ${guests}\n` +
          `  • Contact: ${contact}\n\n` +
          `Please note: a valid photo ID is required at check-in and payment is ` +
          `settled at the front desk on arrival.\n\n` +
          `Shall I confirm this reservation? (Yes / No)`,
        gateReason: 'booking_confirmation',
      };
    }

    return null; // all gates passed — allow execution
  },
};

// ── Billing-dispute keywords ───────────────────────────────────────────────────

const BILLING_KEYWORDS = [
  'charge', 'overcharged', 'invoice', 'receipt', 'bill', 'refund', 'dispute',
];

// ── Main policy check ──────────────────────────────────────────────────────────

/**
 * Evaluate whether a CALL_TOOL action should be blocked.
 * Call this BEFORE executing the tool.
 */
export function checkPolicy(action: NextAction, session: Session): PolicyResult {
  if (action.action !== 'CALL_TOOL') return ALLOWED_POLICY;

  const args = action.args as Record<string, unknown>;

  // Billing dispute → immediate HANDOFF ───────────────────────────────────────
  const lastMsg = lastUserMessage(session).toLowerCase();
  if (BILLING_KEYWORDS.some((kw) => lastMsg.includes(kw))) {
    return {
      requiresConfirmation: false,
      mustHandoff: true,
      handoffReason: 'Billing inquiry or dispute requires a human agent.',
      gateReason: 'billing_dispute',
    };
  }

  // find_reservation: escalate after 2 consecutive misses ────────────────────
  if (action.tool === 'find_reservation' && session.reservationNotFoundCount >= 2) {
    return {
      requiresConfirmation: false,
      mustHandoff: true,
      handoffReason:
        'Reservation not found after multiple attempts. Escalating to front desk staff.',
      gateReason: 'reservation_not_found',
    };
  }

  // Tool-specific gates ────────────────────────────────────────────────────────
  const gateFn = TOOL_GATES[action.tool];
  if (gateFn) {
    const result = gateFn(args, session);
    if (result) return result;
  }

  return ALLOWED_POLICY;
}

// ── Session helpers ────────────────────────────────────────────────────────────

/**
 * Update session state after a find_reservation result.
 * Tracks consecutive "not found" responses to trigger HANDOFF threshold.
 */
export function trackReservationResult(session: Session, result: unknown): void {
  const res = result as { matches?: unknown[] };
  if (Array.isArray(res.matches) && res.matches.length === 0) {
    session.reservationNotFoundCount = (session.reservationNotFoundCount ?? 0) + 1;
  } else {
    session.reservationNotFoundCount = 0;
  }
}
