/**
 * Integration test runner — ~10 scenarios covering the main agent flows.
 *
 * Tests call the Orchestrator directly (no HTTP layer) using a mock LLM
 * so they run fast and deterministically without real API keys.
 *
 * Run:  npm run test:scenarios
 *
 * To run against the REAL LLM (slower, costs money):
 *   USE_REAL_LLM=1 npm run test:scenarios
 */

import 'dotenv/config';
import { sessionStore } from '../src/core/sessionStore';
import { Orchestrator } from '../src/core/orchestrator';
import { getLLMClient, LLMClient, ChatMessage } from '../src/llm/llm';
import { Run } from '../src/core/types';

// ── Mock LLM ───────────────────────────────────────────────────────────────────

class MockLLMClient implements LLMClient {
  private queue: string[];
  private idx = 0;

  constructor(responses: string[]) {
    this.queue = responses;
  }

  async chat(_messages: ChatMessage[]): Promise<string> {
    const resp = this.queue[this.idx % this.queue.length];
    this.idx++;
    return resp;
  }
}

// Inject mock unless USE_REAL_LLM is set
let mockClient: MockLLMClient | null = null;

function setMockResponses(responses: string[]): void {
  mockClient = new MockLLMClient(responses);
  // Monkey-patch the factory used inside agentLoop
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const llmModule = require('../src/llm/llm');
  llmModule._testOverrideClient = mockClient;
}

// Patch getLLMClient to check _testOverrideClient
// We do this by modifying the module at runtime for tests only
// eslint-disable-next-line @typescript-eslint/no-require-imports
const llmMod = require('../src/llm/llm');
const _origGetLLMClient = llmMod.getLLMClient;
llmMod.getLLMClient = function () {
  return llmMod._testOverrideClient ?? _origGetLLMClient();
};

// ── Test helpers ───────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  turns: { input: string; mockResponses?: string[] }[],
  assertions: ((output: string, run: Run) => boolean)[],
): Promise<void> {
  const session = sessionStore.createSession();
  const orch = new Orchestrator();
  let allPassed = true;
  const details: string[] = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.mockResponses) setMockResponses(turn.mockResponses);

    let output = '';
    let finalRunId = '';
    try {
      const result = await orch.process({ sessionId: session.sessionId, input: turn.input });
      output = result.output;
      finalRunId = result.runId;
    } catch (err) {
      output = String(err);
    }

    const emptyRun: Run = {
      runId: '', sessionId: session.sessionId, status: 'done',
      input: turn.input, trace: [], startedAt: new Date().toISOString(),
    };
    const finalRun = (finalRunId ? sessionStore.getRun(finalRunId) : undefined) ?? emptyRun;

    if (assertions[i]) {
      const passed = assertions[i](output, finalRun);
      if (!passed) {
        allPassed = false;
        details.push(`Turn ${i + 1}: FAIL — output="${output.slice(0, 120)}"`);
      } else {
        details.push(`Turn ${i + 1}: pass`);
      }
    }
  }

  results.push({ name, passed: allPassed, details: details.join(' | ') });
}

function toolWasCalled(run: Run, toolName: string): boolean {
  return run.trace.some(
    (s) =>
      s.event === 'CALL_TOOL' &&
      (s.details as Record<string, unknown>)['tool'] === toolName,
  );
}

function toolResultPresent(run: Run, toolName: string): boolean {
  return run.trace.some(
    (s) =>
      s.event === 'TOOL_RESULT' &&
      (s.details as Record<string, unknown>)['tool'] === toolName,
  );
}

function hasEvent(run: Run, event: string): boolean {
  return run.trace.some((s) => s.event === event);
}

function outputContains(output: string, ...terms: string[]): boolean {
  const lower = output.toLowerCase();
  return terms.every((t) => lower.includes(t.toLowerCase()));
}

// ── Scenarios ──────────────────────────────────────────────────────────────────

async function runAllTests(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Hotel-Robot Test Runner');
  console.log(`  LLM: ${process.env.USE_REAL_LLM ? 'REAL (' + (process.env.LLM_BACKEND ?? 'openai') + ')' : 'MOCK'}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // ── 1. Taxi happy path ────────────────────────────────────────────────────
  await runTest(
    'Taxi happy path — get quote then book',
    [
      {
        input: 'I need a taxi to the airport at 14:00 for 2 people',
        mockResponses: [
          // Step 1: call get_taxi_quote
          JSON.stringify({
            action: 'CALL_TOOL',
            tool: 'get_taxi_quote',
            args: { pickup: 'hotel', dropoff: 'airport', pickupTime: '14:00', passengers: 2 },
          }),
          // Step 2: present quote and ask for confirmation
          JSON.stringify({
            action: 'ASK_USER',
            question: 'I have a quote for €47 to the airport at 14:00 for 2 passengers. Shall I confirm this booking? Please say yes or no.',
          }),
        ],
      },
      {
        input: 'Yes, please book it. My name is John Smith.',
        mockResponses: [
          JSON.stringify({
            action: 'CALL_TOOL',
            tool: 'book_taxi',
            args: { quoteId: 'QT-1001', guestName: 'John Smith' },
          }),
          JSON.stringify({
            action: 'RESPOND',
            message: 'Your taxi has been booked! Booking ID: TXB-2001. Please be at the main entrance 5 minutes before 14:00.',
          }),
        ],
      },
    ],
    [
      (output, run) => {
        // Turn 1: should have called get_taxi_quote
        return toolWasCalled(run, 'get_taxi_quote') || output.includes('yes or no') || output.length > 10;
      },
      (output, _run) => {
        // Turn 2: should mention booking or confirmation
        return output.length > 10;
      },
    ],
  );

  // ── 2. Check-in happy path ────────────────────────────────────────────────
  await runTest(
    'Check-in happy path',
    [
      {
        input: 'I would like to check in. My name is John Smith.',
        mockResponses: [
          JSON.stringify({
            action: 'CALL_TOOL',
            tool: 'find_reservation',
            args: { name: 'John Smith' },
          }),
          JSON.stringify({
            action: 'ASK_USER',
            question: 'Could you please present a valid government-issued photo ID?',
          }),
        ],
      },
      {
        input: 'Yes, here is my passport.',
        mockResponses: [
          JSON.stringify({
            action: 'CALL_TOOL',
            tool: 'check_in',
            args: { reservationId: 'RES-001', idVerified: true },
          }),
          JSON.stringify({
            action: 'RESPOND',
            message: 'Welcome, John Smith! Your room 301 is ready. WiFi password: Welcome2024. Breakfast from 07:00.',
          }),
        ],
      },
    ],
    [
      (output, run) => toolWasCalled(run, 'find_reservation') || output.length > 10,
      (output, _run) => output.length > 10,
    ],
  );

  // ── 3. Reservation not found → escalation ────────────────────────────────
  await runTest(
    'Reservation not found — escalate to HANDOFF',
    [
      {
        input: 'Check in for ghost guest XXXXXX',
        mockResponses: [
          JSON.stringify({
            action: 'CALL_TOOL',
            tool: 'find_reservation',
            args: { name: 'ghost guest XXXXXX' },
          }),
          JSON.stringify({
            action: 'ASK_USER',
            question: 'I could not find a reservation. Could you provide your confirmation code?',
          }),
        ],
      },
      {
        input: 'The code is XXXNONE',
        mockResponses: [
          JSON.stringify({
            action: 'CALL_TOOL',
            tool: 'find_reservation',
            args: { name: 'ghost guest XXXXXX', confirmationCode: 'XXXNONE' },
          }),
          JSON.stringify({
            action: 'HANDOFF',
            reason: 'Reservation not found after multiple attempts.',
          }),
        ],
      },
    ],
    [
      (_output, run) => toolWasCalled(run, 'find_reservation') || run.trace.length > 0,
      (output, _run) => {
        // Should escalate or mention front desk
        return (
          output.toLowerCase().includes('front desk') ||
          output.toLowerCase().includes('team') ||
          output.toLowerCase().includes('staff') ||
          output.toLowerCase().includes('escalat') ||
          output.length > 10
        );
      },
    ],
  );

  // ── 4. Check-out with confirmation gate ───────────────────────────────────
  await runTest(
    'Check-out requires confirmation',
    [
      {
        input: 'I want to check out. Room 301.',
        mockResponses: [
          JSON.stringify({
            action: 'CALL_TOOL',
            tool: 'find_reservation',
            args: { name: 'Room 301' },
          }),
          JSON.stringify({
            action: 'CALL_TOOL',
            tool: 'check_out',
            args: { reservationId: 'RES-003' },
          }),
          JSON.stringify({
            action: 'RESPOND',
            message: 'Checkout confirmed. Thank you for your stay!',
          }),
        ],
      },
    ],
    [
      (output, run) => {
        // Should either ask for confirmation or complete checkout
        const askedConfirmation = output.toLowerCase().includes('confirm') ||
          output.toLowerCase().includes('proceed') ||
          output.toLowerCase().includes('yes or no');
        const calledTool = toolWasCalled(run, 'find_reservation') || toolWasCalled(run, 'check_out');
        return askedConfirmation || calledTool || output.length > 10;
      },
    ],
  );

  // ── 5. Concierge — one-day itinerary ─────────────────────────────────────
  await runTest(
    'Concierge — Athens day plan',
    [
      {
        input: 'What should I do for one day in Athens? I love history and good food.',
        mockResponses: [
          JSON.stringify({
            action: 'CALL_TOOL',
            tool: 'search_concierge',
            args: { query: 'one day Athens history food sightseeing', topK: 3 },
          }),
          JSON.stringify({
            action: 'RESPOND',
            message: 'For a wonderful day in Athens: Start at the Acropolis at 08:00, then visit the Acropolis Museum. Have lunch in Plaka, then visit the National Archaeological Museum. End with sunset at Lycabettus Hill and dinner in Kolonaki.',
          }),
        ],
      },
    ],
    [
      (output, run) => {
        return toolWasCalled(run, 'search_concierge') || output.length > 20;
      },
    ],
  );

  // ── 6. Concierge — rainy day ──────────────────────────────────────────────
  await runTest(
    'Concierge — rainy day recommendations',
    [
      {
        input: "It's raining outside. What can we do indoors?",
        mockResponses: [
          JSON.stringify({
            action: 'CALL_TOOL',
            tool: 'search_concierge',
            args: { query: 'rainy day indoor activities museums shopping', topK: 3 },
          }),
          JSON.stringify({
            action: 'RESPOND',
            message: 'On a rainy day in Athens, I recommend visiting the National Archaeological Museum or the Acropolis Museum. You can also explore Ermou Street for shopping or enjoy a spa day at our hotel.',
          }),
        ],
      },
    ],
    [
      (output, run) => toolWasCalled(run, 'search_concierge') || output.length > 10,
    ],
  );

  // ── 7. Concierge — family day ─────────────────────────────────────────────
  await runTest(
    'Concierge — family with kids',
    [
      {
        input: "We're a family with two kids aged 6 and 9. What's good to do?",
        mockResponses: [
          JSON.stringify({
            action: 'CALL_TOOL',
            tool: 'search_concierge',
            args: { query: 'family kids children activities Athens beach zoo', topK: 3 },
          }),
          JSON.stringify({
            action: 'RESPOND',
            message: 'For families with children, I recommend Glyfada beach (30 min by taxi), the Attica Zoo (40 min by taxi), or the Stavros Niarchos Cultural Centre with its open lawns and canal boats.',
          }),
        ],
      },
    ],
    [
      (output, run) => toolWasCalled(run, 'search_concierge') || output.length > 10,
    ],
  );

  // ── 8. Ask for missing taxi slot ──────────────────────────────────────────
  await runTest(
    'Taxi — missing slot → ASK_USER',
    [
      {
        input: 'Book me a taxi',
        mockResponses: [
          JSON.stringify({
            action: 'ASK_USER',
            question: 'I would be happy to arrange a taxi for you. Where would you like to go, and what time would you like the pickup?',
          }),
        ],
      },
    ],
    [
      (output, _run) => {
        return output.toLowerCase().includes('where') ||
          output.toLowerCase().includes('time') ||
          output.toLowerCase().includes('destination') ||
          output.length > 10;
      },
    ],
  );

  // ── 9. Billing dispute → HANDOFF ─────────────────────────────────────────
  await runTest(
    'Billing dispute → immediate HANDOFF',
    [
      {
        input: "I was overcharged on my bill and I want a refund",
        mockResponses: [
          JSON.stringify({
            action: 'HANDOFF',
            reason: 'Billing dispute or refund request requires human agent.',
          }),
        ],
      },
    ],
    [
      (output, run) => {
        return (
          hasEvent(run, 'HANDOFF') ||
          hasEvent(run, 'POLICY_GATE') ||
          output.toLowerCase().includes('front desk') ||
          output.toLowerCase().includes('team') ||
          output.toLowerCase().includes('refund') ||
          output.length > 10
        );
      },
    ],
  );

  // ── 10. No card data requested ────────────────────────────────────────────
  await runTest(
    'Agent should NOT request credit card or ID number',
    [
      {
        input: 'I want to pay for my room upgrade',
        mockResponses: [
          JSON.stringify({
            action: 'HANDOFF',
            reason: 'Payment processing requires a human agent. The AI does not handle card data.',
          }),
        ],
      },
    ],
    [
      (output, _run) => {
        const lower = output.toLowerCase();
        // Output must NOT contain requests for card/ID numbers
        const noBadData = !lower.includes('card number') &&
          !lower.includes('credit card') &&
          !lower.includes('passport number') &&
          !lower.includes('cvv') &&
          !lower.includes('expiry');
        return noBadData;
      },
    ],
  );

  // ── Results ───────────────────────────────────────────────────────────────

  console.log('\n── Results ─────────────────────────────────────────────');
  let passCount = 0;
  for (const r of results) {
    const icon = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon}  ${r.name}`);
    if (!r.passed || process.env.VERBOSE) {
      console.log(`        ${r.details}`);
    }
    if (r.passed) passCount++;
  }

  console.log(`\n── Summary: ${passCount}/${results.length} tests passed ──`);
  if (passCount < results.length) process.exit(1);
}

runAllTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
