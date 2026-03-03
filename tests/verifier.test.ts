/**
 * verifier.test.ts — Regression tests for the Verifier module.
 *
 * Run with:   npm run test:verifier
 *
 * Tests verify that:
 *   - tool existence check fires for unknown tools
 *   - policy gates are correctly translated to correctable violations
 *   - fatal policy violations (billing, repeated not-found) become fatal violations
 *   - handoff actions always pass verification
 *   - message safety check blocks credit-card and passport requests
 *   - approved Proposals pass cleanly
 */

import assert from 'assert';
import { verifyProposal, hasFatalViolation, fatalReason } from '../src/core/verifier';
import type { Proposal, Session } from '../src/core/types';

// ── Test harness ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${(e as Error).message}`);
    failed++;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSession(lastUserMsg = '', slots: Record<string, unknown> = {}, reservationNotFoundCount = 0): Session {
  return {
    sessionId: 'test',
    history: lastUserMsg ? [{ role: 'user', content: lastUserMsg }] : [],
    slots,
    reservationNotFoundCount,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    assistant_message: 'How can I help you?',
    proposed_actions: [],
    confidence: 1,
    ...overrides,
  };
}

const FULL_RESERVATION_ARGS = {
  guestName:    'Maria Papadopoulos',
  checkInDate:  '2025-06-10',
  checkOutDate: '2025-06-11',
  roomType:     'Deluxe Double',
  guests:       2,
  contact:      '+30 210 123 4567',
};

// ── Unknown tool ───────────────────────────────────────────────────────────────

console.log('\nUnknown tool:');

test('unknown tool produces correctable violation', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'tool_call', tool: 'delete_everything', args: {} }],
    }),
    makeSession(),
  );
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.violations.length, 1);
  assert.strictEqual(result.violations[0].code, 'unknown_tool');
  assert.strictEqual(result.violations[0].severity, 'correctable');
});

test('known tool with no violations is approved', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'tool_call', tool: 'check_availability', args: { checkInDate: '2025-06-10', checkOutDate: '2025-06-11', guests: 2 } }],
    }),
    makeSession('yes'),
  );
  assert.strictEqual(result.approved, true);
  assert.strictEqual(result.violations.length, 0);
});

// ── Handoff always passes ──────────────────────────────────────────────────────

console.log('\nHandoff actions:');

test('handoff action always passes (no violations)', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'handoff', reason: 'Billing dispute' }],
    }),
    makeSession('I want a refund'),
  );
  assert.strictEqual(result.approved, true);
  assert.strictEqual(result.violations.length, 0);
});

// ── create_reservation slot gates → correctable ───────────────────────────────

console.log('\ncreate_reservation slot gates:');

test('missing guestName → correctable violation with missing_slot:guestFullName', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'tool_call', tool: 'create_reservation', args: { ...FULL_RESERVATION_ARGS, guestName: '' } }],
    }),
    makeSession("I'll take the Deluxe Double"),
  );
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.violations[0].severity, 'correctable');
  assert.strictEqual(result.violations[0].code, 'missing_slot:guestFullName');
});

test('single-word guestName → correctable violation', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'tool_call', tool: 'create_reservation', args: { ...FULL_RESERVATION_ARGS, guestName: 'Maria' } }],
    }),
    makeSession('yes'),
  );
  assert.strictEqual(result.violations[0].code, 'missing_slot:guestFullName');
});

test('missing contact → correctable violation with missing_slot:contact', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'tool_call', tool: 'create_reservation', args: { ...FULL_RESERVATION_ARGS, contact: '' } }],
    }),
    makeSession('yes'),
  );
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.violations[0].code, 'missing_slot:contact');
  assert.strictEqual(result.violations[0].severity, 'correctable');
});

test('booking_confirmation gate → correctable violation when no confirmation', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'tool_call', tool: 'create_reservation', args: FULL_RESERVATION_ARGS }],
    }),
    makeSession("I'll take the Deluxe Double"),
  );
  assert.strictEqual(result.violations[0].code, 'booking_confirmation');
  assert.strictEqual(result.violations[0].severity, 'correctable');
});

test('all slots + confirmation → approved', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'tool_call', tool: 'create_reservation', args: FULL_RESERVATION_ARGS }],
    }),
    makeSession('yes, please confirm'),
  );
  assert.strictEqual(result.approved, true);
  assert.strictEqual(result.violations.length, 0);
});

// ── Fatal violations ──────────────────────────────────────────────────────────

console.log('\nFatal violations:');

test('billing keyword → fatal violation', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'tool_call', tool: 'check_out', args: { reservationId: 'RES001' } }],
    }),
    makeSession('I want to dispute this charge'),
  );
  assert.strictEqual(result.approved, false);
  assert.ok(hasFatalViolation(result), 'should have a fatal violation');
  assert.strictEqual(result.violations[0].code, 'billing_dispute');
  assert.strictEqual(result.violations[0].severity, 'fatal');
});

test('repeated reservation not-found → fatal violation', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'tool_call', tool: 'find_reservation', args: { name: 'Smith' } }],
    }),
    makeSession('Smith', {}, 2),
  );
  assert.ok(hasFatalViolation(result));
  assert.strictEqual(result.violations[0].code, 'reservation_not_found');
});

test('fatalReason returns first fatal violation message', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'tool_call', tool: 'check_out', args: { reservationId: 'RES001' } }],
    }),
    makeSession('I want to dispute this charge'),
  );
  const reason = fatalReason(result);
  assert.ok(typeof reason === 'string' && reason.length > 0);
});

test('fatalReason returns default when no fatal violation', () => {
  const cleanResult = verifyProposal(makeProposal(), makeSession());
  const reason = fatalReason(cleanResult);
  assert.ok(reason.includes('human staff') || reason.length > 0);
});

// ── Message safety ────────────────────────────────────────────────────────────

console.log('\nMessage safety:');

test('credit card request in message → correctable violation', () => {
  const result = verifyProposal(
    makeProposal({ assistant_message: 'Please provide your credit card number to proceed.' }),
    makeSession(),
  );
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.violations[0].code, 'forbidden_data_request');
  assert.strictEqual(result.violations[0].severity, 'correctable');
});

test('CVV request in message → correctable violation', () => {
  const result = verifyProposal(
    makeProposal({ assistant_message: 'Could you share your CVV code?' }),
    makeSession(),
  );
  assert.strictEqual(result.violations[0].code, 'forbidden_data_request');
});

test('passport number request in message → correctable violation', () => {
  const result = verifyProposal(
    makeProposal({ assistant_message: 'Please provide your passport number for check-in.' }),
    makeSession(),
  );
  assert.strictEqual(result.violations[0].code, 'forbidden_data_request');
});

test('document number request in message → correctable violation', () => {
  const result = verifyProposal(
    makeProposal({ assistant_message: 'Could you type your document number so I can verify you?' }),
    makeSession(),
  );
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.violations[0].code, 'forbidden_data_request');
  assert.strictEqual(result.violations[0].severity, 'correctable');
});

test('national ID number request in message → correctable violation', () => {
  const result = verifyProposal(
    makeProposal({ assistant_message: 'Please share your national ID number.' }),
    makeSession(),
  );
  assert.strictEqual(result.violations[0].code, 'forbidden_data_request');
});

test('safe message with no actions → approved', () => {
  const result = verifyProposal(
    makeProposal({ assistant_message: 'Welcome! How can I assist you today?' }),
    makeSession(),
  );
  assert.strictEqual(result.approved, true);
  assert.strictEqual(result.violations.length, 0);
});

// ── hasFatalViolation ─────────────────────────────────────────────────────────

console.log('\nhasFatalViolation helper:');

test('returns false for correctable-only violations', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'tool_call', tool: 'create_reservation', args: { ...FULL_RESERVATION_ARGS, guestName: '' } }],
    }),
    makeSession("I'll take it"),
  );
  assert.strictEqual(hasFatalViolation(result), false);
});

test('returns true for fatal violations', () => {
  const result = verifyProposal(
    makeProposal({
      proposed_actions: [{ type: 'tool_call', tool: 'check_out', args: { reservationId: 'R1' } }],
    }),
    makeSession('dispute charge'),
  );
  assert.strictEqual(hasFatalViolation(result), true);
});

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAIL');
  process.exit(1);
} else {
  console.log('PASS');
}
