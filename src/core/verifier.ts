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

import { Proposal, VerifierViolation, VerifierResult, NextAction } from './types';
import { Session } from './types';
import { checkPolicy } from './policy';
import { getTool } from '../tools/registry';

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Verify a Proposal against:
 *   1. Tool existence
 *   2. Policy gates (slot completeness, confirmation requirements, billing rules)
 *   3. Basic message safety (no forbidden data collection)
 */
export function verifyProposal(proposal: Proposal, session: Session): VerifierResult {
  const violations: VerifierViolation[] = [];

  for (const action of proposal.proposed_actions) {
    // handoff actions are always valid — the LLM's decision to escalate is respected
    if (action.type === 'handoff') continue;

    // ── Tool existence check ───────────────────────────────────────────────────
    const toolDef = getTool(action.tool);
    if (!toolDef) {
      violations.push({
        code: 'unknown_tool',
        message:
          `"${action.tool}" is not a valid tool. ` +
          `Remove it from proposed_actions and use only the tools listed in the system prompt.`,
        severity: 'correctable',
      });
      continue; // skip policy check — tool doesn't exist
    }

    // ── Policy gate check ──────────────────────────────────────────────────────
    // Construct a NextAction shape that checkPolicy understands
    const fakeAction: NextAction = {
      action: 'CALL_TOOL',
      tool: action.tool,
      args: action.args,
    };

    const policy = checkPolicy(fakeAction, session);

    if (policy.mustHandoff) {
      violations.push({
        code: policy.gateReason ?? 'policy:handoff_required',
        message:
          policy.handoffReason ??
          'This request must be handled by human staff. Use {"type":"handoff"} instead of a tool call.',
        severity: 'fatal',
      });
    } else if (policy.requiresConfirmation) {
      violations.push({
        code: policy.gateReason ?? 'policy:confirmation_required',
        message: buildCorrectionMessage(policy.gateReason, policy.confirmationQuestion, action.tool),
        severity: 'correctable',
      });
    }
  }

  // ── Message safety check ────────────────────────────────────────────────────
  const msgViolation = checkMessageSafety(proposal.assistant_message);
  if (msgViolation) violations.push(msgViolation);

  const hasFatal = violations.some((v) => v.severity === 'fatal');

  return {
    approved: violations.length === 0,
    violations,
    // Convenience: if fatal violations exist, the loop should HANDOFF immediately
    ...(hasFatal && { _hasFatal: true }),  // internal hint used by agentLoop
  } as VerifierResult & { _hasFatal?: boolean };
}

/** True if any violation in the result is fatal. */
export function hasFatalViolation(result: VerifierResult): boolean {
  return result.violations.some((v) => v.severity === 'fatal');
}

/** Returns the first fatal violation's message, or a default. */
export function fatalReason(result: VerifierResult): string {
  return (
    result.violations.find((v) => v.severity === 'fatal')?.message ??
    'This request requires human staff assistance.'
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Convert a policy gate reason code + question into an actionable correction message
 * that clearly tells the LLM what it needs to do differently.
 */
function buildCorrectionMessage(
  gateReason: string | undefined,
  confirmationQuestion: string | undefined,
  tool: string,
): string {
  switch (gateReason) {
    case 'missing_slot:guestFullName':
      return (
        `Do NOT include ${tool} in proposed_actions yet. ` +
        `First ask the guest for their full name (first AND last name). ` +
        `Set assistant_message to: "${confirmationQuestion ?? "Could I have your full name please?"}"`
      );

    case 'missing_slot:contact':
      return (
        `Do NOT include ${tool} in proposed_actions yet. ` +
        `First ask the guest for their contact information (phone number or email). ` +
        `Set assistant_message to: "${confirmationQuestion ?? "Could I take a contact number or email?"}"`
      );

    case 'booking_confirmation':
      return (
        `Do NOT include ${tool} in proposed_actions yet. ` +
        `Show the booking summary in assistant_message and ask the guest to confirm. ` +
        `Only include the tool call after the guest explicitly says yes. ` +
        `Summary to show:\n${confirmationQuestion ?? 'Show booking details and ask for confirmation.'}`
      );

    default:
      return (
        `Do NOT call ${tool} yet. ` +
        (confirmationQuestion
          ? `First: ${confirmationQuestion}`
          : 'Additional information or confirmation is required before proceeding.')
      );
  }
}

/** Checks the assistant_message for patterns that violate safety rules. */
function checkMessageSafety(message: string): VerifierViolation | null {
  // Detect requests for forbidden data (card numbers, passport/ID/document numbers)
  const forbiddenPatterns = [
    { re: /credit\s*card|card\s*number|cvv|cvc/i, label: 'credit card details' },
    {
      re: /passport\s*number|document\s*number|id\s*number|national\s*id/i,
      label: 'passport or document numbers — use the ID Scan button in the UI instead of asking the guest to type numbers',
    },
  ];

  for (const { re, label } of forbiddenPatterns) {
    if (re.test(message)) {
      return {
        code: 'forbidden_data_request',
        message:
          `Your assistant_message appears to request ${label}. ` +
          `Never ask guests for card numbers, passport numbers, or government ID details. ` +
          `Payment is handled at the front desk. Remove this from your message.`,
        severity: 'correctable',
      };
    }
  }

  return null;
}
