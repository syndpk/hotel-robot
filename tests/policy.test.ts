/**
 * policy.test.ts — Regression tests for policy gate enforcement.
 *
 * Run with:   npm test
 *
 * These are plain Node assertions — no framework required.
 * Exit code 0 = all pass.  Exit code 1 = at least one failure.
 */

import assert from 'assert';
import { checkPolicy } from '../src/core/policy';
import type { Session } from '../src/core/types';

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

function makeSession(lastUserMsg = '', slots: Record<string, unknown> = {}): Session {
  return {
    sessionId: 'test',
    history: lastUserMsg ? [{ role: 'user', content: lastUserMsg }] : [],
    slots,
    reservationNotFoundCount: 0,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

const FULL_ARGS = {
  guestName:    'Maria Papadopoulos',
  checkInDate:  '2025-06-10',
  checkOutDate: '2025-06-11',
  roomType:     'Deluxe Double',
  guests:       2,
  contact:      '+30 210 123 4567',
};

// ── create_reservation slot gates ──────────────────────────────────────────────

console.log('\ncreate_reservation slot gates:');

test('blocks when guestName is empty', () => {
  const result = checkPolicy(
    { action: 'CALL_TOOL', tool: 'create_reservation', args: { ...FULL_ARGS, guestName: '' } },
    makeSession('I want the Deluxe Double'),
  );
  assert.strictEqual(result.requiresConfirmation, true, 'should require confirmation');
  assert.strictEqual(result.gateReason, 'missing_slot:guestFullName');
  assert.ok(result.confirmationQuestion?.includes('full name'), 'question should mention full name');
});

test('blocks when guestName has only one word (no last name)', () => {
  const result = checkPolicy(
    { action: 'CALL_TOOL', tool: 'create_reservation', args: { ...FULL_ARGS, guestName: 'Maria' } },
    makeSession('I want the Deluxe Double'),
  );
  assert.strictEqual(result.requiresConfirmation, true);
  assert.strictEqual(result.gateReason, 'missing_slot:guestFullName');
});

test('blocks when contact is missing', () => {
  const result = checkPolicy(
    { action: 'CALL_TOOL', tool: 'create_reservation', args: { ...FULL_ARGS, contact: '' } },
    makeSession('Maria Papadopoulos'),
  );
  assert.strictEqual(result.requiresConfirmation, true);
  assert.strictEqual(result.gateReason, 'missing_slot:contact');
  assert.ok(result.confirmationQuestion?.toLowerCase().includes('contact') ||
            result.confirmationQuestion?.toLowerCase().includes('phone') ||
            result.confirmationQuestion?.toLowerCase().includes('email'),
    'question should ask for contact');
});

test('blocks with contact gate before booking summary when only contact missing', () => {
  // name is fine, contact is missing — must ask for contact, not show summary
  const result = checkPolicy(
    { action: 'CALL_TOOL', tool: 'create_reservation', args: { ...FULL_ARGS, contact: '' } },
    makeSession('yes'),   // even if user said yes, contact is still missing
  );
  assert.strictEqual(result.gateReason, 'missing_slot:contact',
    'contact gate must fire before booking_confirmation gate');
});

test('shows booking summary when name + contact present but no confirmation yet', () => {
  const result = checkPolicy(
    { action: 'CALL_TOOL', tool: 'create_reservation', args: FULL_ARGS },
    makeSession("I'll take the Deluxe Double"),
  );
  assert.strictEqual(result.requiresConfirmation, true);
  assert.strictEqual(result.gateReason, 'booking_confirmation');
  assert.ok(result.confirmationQuestion?.includes('Maria Papadopoulos'), 'summary must include guest name');
  assert.ok(result.confirmationQuestion?.includes('photo ID'), 'summary must mention photo ID');
  assert.ok(result.confirmationQuestion?.includes('front desk'), 'summary must mention front desk');
});

test('booking summary includes contact details', () => {
  const result = checkPolicy(
    { action: 'CALL_TOOL', tool: 'create_reservation', args: FULL_ARGS },
    makeSession('My phone is +30 210 123 4567'),
  );
  assert.ok(result.confirmationQuestion?.includes('+30 210 123 4567'), 'summary must include contact');
});

test('allows through when all slots present and last message is confirmation', () => {
  const result = checkPolicy(
    { action: 'CALL_TOOL', tool: 'create_reservation', args: FULL_ARGS },
    makeSession('yes, please confirm'),
  );
  assert.strictEqual(result.requiresConfirmation, false);
  assert.strictEqual(result.mustHandoff, false);
});

test('allows through on "go ahead"', () => {
  const result = checkPolicy(
    { action: 'CALL_TOOL', tool: 'create_reservation', args: FULL_ARGS },
    makeSession('go ahead'),
  );
  assert.strictEqual(result.requiresConfirmation, false);
});

// ── Regression: room selected but no details provided ─────────────────────────

console.log('\nRegression — room selected with no name/contact:');

test('REGRESSION: agent calls create_reservation immediately after room selection with no name', () => {
  // Simulates the bug: LLM calls create_reservation right after the guest
  // selects a room, without having collected name or contact yet.
  const result = checkPolicy(
    {
      action: 'CALL_TOOL',
      tool:   'create_reservation',
      args: {
        guestName:    '',          // not yet collected
        checkInDate:  '2025-06-10',
        checkOutDate: '2025-06-11',
        roomType:     'Standard Single',
        guests:       1,
        contact:      '',          // not yet collected
      },
    },
    makeSession("I'll take the Standard Single"),
  );
  // Must block at the name gate — not proceed to create the reservation
  assert.strictEqual(result.requiresConfirmation, true,
    'must block — name and contact not collected');
  assert.strictEqual(result.gateReason, 'missing_slot:guestFullName',
    'must ask for full name first, not proceed');
  assert.strictEqual(result.mustHandoff, false,
    'should not HANDOFF — just ask for missing slot');
});

test('REGRESSION: agent calls create_reservation with first name only', () => {
  const result = checkPolicy(
    {
      action: 'CALL_TOOL',
      tool:   'create_reservation',
      args: {
        guestName:    'John',    // first name only — not acceptable
        checkInDate:  '2025-06-10',
        checkOutDate: '2025-06-11',
        roomType:     'Standard Single',
        guests:       1,
        contact:      '',
      },
    },
    makeSession('yes'),
  );
  // Even though user said "yes", name is still incomplete → must block at name gate
  assert.strictEqual(result.gateReason, 'missing_slot:guestFullName',
    'name gate must fire even if user said yes');
});

// ── Other policy gates ─────────────────────────────────────────────────────────

console.log('\nOther policy gates:');

test('billing keyword triggers HANDOFF', () => {
  const result = checkPolicy(
    { action: 'CALL_TOOL', tool: 'check_out', args: { reservationId: 'RES001' } },
    makeSession('I want to dispute this charge'),
  );
  assert.strictEqual(result.mustHandoff, true);
  assert.strictEqual(result.gateReason, 'billing_dispute');
});

test('find_reservation triggers HANDOFF after 2 misses', () => {
  const session = makeSession('Smith');
  session.reservationNotFoundCount = 2;
  const result = checkPolicy(
    { action: 'CALL_TOOL', tool: 'find_reservation', args: { name: 'Smith' } },
    session,
  );
  assert.strictEqual(result.mustHandoff, true);
  assert.strictEqual(result.gateReason, 'reservation_not_found');
});

test('check_out requires confirmation when last message is not affirmative', () => {
  const result = checkPolicy(
    { action: 'CALL_TOOL', tool: 'check_out', args: { reservationId: 'RES001' } },
    makeSession('I want to check out'),
  );
  assert.strictEqual(result.requiresConfirmation, true);
  assert.strictEqual(result.gateReason, 'booking_confirmation');
});

test('check_out allowed when last message is confirmation', () => {
  const result = checkPolicy(
    { action: 'CALL_TOOL', tool: 'check_out', args: { reservationId: 'RES001' } },
    makeSession('yes'),
  );
  assert.strictEqual(result.requiresConfirmation, false);
  assert.strictEqual(result.mustHandoff, false);
});

test('non-CALL_TOOL action always returns allowed', () => {
  const result = checkPolicy(
    { action: 'RESPOND', message: 'Hello!' },
    makeSession(),
  );
  assert.strictEqual(result.requiresConfirmation, false);
  assert.strictEqual(result.mustHandoff, false);
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
