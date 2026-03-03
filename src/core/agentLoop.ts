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

import { getLLMClient, LLMClient } from '../llm/llm';
import {
  ProposalSchema,
  Proposal,
  AgentContext,
  Session,
  StepRecord,
  TraceStep,
  TraceEventType,
  NextAction,
  IdentitySlot,
} from './types';
import { verifyProposal, hasFatalViolation, fatalReason } from './verifier';
import { executeTool, buildToolSchemasText } from '../tools/registry';
import { trackReservationResult } from './policy';
import { HOTEL_CONFIG } from '../config/hotel';

const MAX_STEPS      = 8;   // maximum tool-call iterations per run
const MAX_CORRECTIONS = 2;  // maximum verifier-correction retries per step

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildSystemPrompt(context: AgentContext): string {
  const { hotelConfig, selectedSkills, conciergeSnippets } = context;

  const policyJson = JSON.stringify(hotelConfig.policies, null, 2);

  const skillsText =
    selectedSkills.length > 0
      ? selectedSkills.map((s) => `## ${s.name}\n${s.content}`).join('\n\n---\n\n')
      : '(No specific skill selected for this query.)';

  const conciergeText =
    conciergeSnippets.length > 0
      ? conciergeSnippets.map((s) => `[Source: ${s.sourceId}]\n${s.text}`).join('\n\n')
      : '(No concierge snippets retrieved.)';

  const toolSchemas = buildToolSchemasText();

  // SESSION CONTEXT — sessionId needed for document.extract tool arg
  const sessionCtx = `## SESSION CONTEXT\nSession ID: ${context.sessionId}`;

  // IDENTITY INJECTION — injected for both confirmed and pending scans
  let identitySection = '';
  const identity = context.slots['identity'] as IdentitySlot | undefined;
  if (identity) {
    const f = identity.maskedFields;
    const lines: string[] = [];
    if (f.fullName)        lines.push(`Full Name:        ${f.fullName}`);
    if (f.documentType)    lines.push(`Document Type:    ${f.documentType}`);
    if (f.nationality)     lines.push(`Nationality:      ${f.nationality}`);
    if (f.dateOfBirth)     lines.push(`Date of Birth:    ${f.dateOfBirth}`);
    if (f.expiryDate)      lines.push(`Expiry Date:      ${f.expiryDate}`);
    if (f.issuingCountry)  lines.push(`Issuing Country:  ${f.issuingCountry}`);
    if (f.documentNumber)  lines.push(`Doc Number:       ${f.documentNumber} (masked)`);
    if (f.mrzMaskedLast6)  lines.push(`MRZ Last-2:       ${f.mrzMaskedLast6}`);
    const checksumLine = `Checksum Valid:   ${identity.checksumValid ? 'Yes ✓' : 'No ✗'}`;
    const confLine     = `Confidence:       ${Math.round(identity.confidences.overall * 100)}%`;

    if (identity.confirmedByUser) {
      identitySection =
        `\n\n## VERIFIED ID DATA (masked)\n` +
        lines.join('\n') + '\n' + checksumLine + '\n' + confLine +
        `\n→ Guest has confirmed these details. You may pass idVerified=true to check_in.` +
        `\n→ Privacy: only masked/partial data is stored — never the full document number.`;
    } else {
      identitySection =
        `\n\n## PENDING ID SCAN (captured — awaiting guest confirmation)\n` +
        lines.join('\n') + '\n' + checksumLine + '\n' + confLine +
        `\n→ Guest has NOT yet confirmed these details. Do NOT use idVerified=true until confirmed.`;
    }
  }

  return `You are a warm, professional hotel receptionist at ${hotelConfig.name}, ${hotelConfig.address}, ${hotelConfig.city}.

${sessionCtx}${identitySection}

## HOTEL
- Check-in: ${hotelConfig.checkInTime}  |  Check-out: ${hotelConfig.checkOutTime}
- Phone: ${hotelConfig.phone}
- Policies:
${policyJson}

## SKILL GUARDRAILS
${skillsText}

## CONCIERGE KNOWLEDGE
${conciergeText}

## AVAILABLE TOOLS
${toolSchemas}

## OUTPUT FORMAT
Every response must be a single JSON object:
{
  "assistant_message": "<natural reply to show the guest>",
  "proposed_actions":  [ /* zero or more tool_call or handoff objects */ ],
  "confidence":        0.95
}

Shapes for proposed_actions entries:
  {"type":"tool_call","tool":"<name>","args":{...}}
  {"type":"handoff","reason":"<why escalating>"}

Rules:
- assistant_message is ALWAYS required — write it as if speaking directly to the guest.
- proposed_actions may be empty (respond-only turn).
- Never invent reservation IDs, prices, room numbers, or booking IDs.
- Never request card numbers, passport numbers, or government ID details.
- Never include more than one tool_call per response.
- Use handoff only when the skill guardrails require it.
- If the guest asks what information is on their ID / document, refer ONLY to the fields
  in ## VERIFIED ID DATA (masked) above. List the masked fields and add: "For privacy, only
  partial data is stored — your full document number is never retained."
  Do NOT ask for their name again if it already appears in ## VERIFIED ID DATA.

## EXAMPLES

Guest asks about check-in time:
{"assistant_message":"Check-in is at ${hotelConfig.checkInTime} and check-out at ${hotelConfig.checkOutTime}. Is there anything else I can help you with?","proposed_actions":[],"confidence":1}

Guest wants to check out (name collected, not yet confirmed):
{"assistant_message":"Shall I go ahead and check you out now?","proposed_actions":[],"confidence":0.95}

Guest confirms check-out:
{"assistant_message":"Checking you out now — one moment please.","proposed_actions":[{"type":"tool_call","tool":"check_out","args":{"reservationId":"RES-001"}}],"confidence":0.98}

Guest disputes a charge:
{"assistant_message":"I understand your concern. Let me connect you with our billing team right away.","proposed_actions":[{"type":"handoff","reason":"Guest is disputing a charge — requires manager review."}],"confidence":1}

Walk-in guest confirms room choice (name and contact already collected):
{"assistant_message":"Let me confirm your reservation now.","proposed_actions":[{"type":"tool_call","tool":"create_reservation","args":{"guestName":"Maria Papadopoulos","checkInDate":"2025-06-10","checkOutDate":"2025-06-11","roomType":"Deluxe Double","guests":2,"contact":"+30 210 123 4567"}}],"confidence":0.97}`;
}

function now(): string {
  return new Date().toISOString();
}

// ── JSON extraction ────────────────────────────────────────────────────────────

/**
 * Attempt to pull a JSON object out of a raw LLM response string.
 * Returns parsed value or null — never throws.
 *
 * Strategy:
 *   (a) JSON.parse(raw.trim())                         — clean output
 *   (b) strip ``` fences, retry                        — markdown-wrapped output
 *   (c) slice from first '{' to last '}', retry        — prose before/after JSON
 */
function tryExtractJSON(raw: string): unknown | null {
  try { return JSON.parse(raw.trim()); } catch { /* fall through */ }

  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }

  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* fall through */ }
  }

  return null;
}

// ── propose-and-verify inner loop ──────────────────────────────────────────────

/**
 * Ask the LLM for a Proposal, run the verifier, and retry with correction
 * prompts up to MAX_CORRECTIONS times if violations are correctable.
 *
 * Returns { proposal, attempts } on success (verifier approved), or null if
 * the LLM could not produce a valid, approved Proposal after all retries.
 */
async function proposeAndVerify(
  baseMessages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  llm: LLMClient,
  session: Session,
  emit: (event: TraceEventType, details: unknown, durationMs?: number) => void,
): Promise<{ proposal: Proposal; attempts: number } | null> {
  const messages = [...baseMessages];
  let attempts = 0;

  for (let correction = 0; correction <= MAX_CORRECTIONS; correction++) {
    const t0 = Date.now();

    // ── LLM call ──────────────────────────────────────────────────────────────
    let raw: string;
    try {
      raw = await llm.chat(messages, { temperature: 0.1, maxTokens: 700 });
    } catch (err) {
      emit('ERROR', { error: 'LLM call failed', detail: err instanceof Error ? err.message : String(err) }, Date.now() - t0);
      return null;
    }
    attempts++;

    // ── Parse ─────────────────────────────────────────────────────────────────
    const extracted = tryExtractJSON(raw);
    if (extracted === null) {
      emit('PARSE_ERROR', { raw_model_output: raw.slice(0, 300), correction_attempt: correction }, Date.now() - t0);
      // Ask model to fix format before next iteration
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content:
          'Your response was not valid JSON. Please output ONLY the JSON object described in the system prompt. No extra text, no markdown fences.',
      });
      continue;
    }

    const validation = ProposalSchema.safeParse(extracted);
    if (!validation.success) {
      emit('PARSE_ERROR', {
        extracted,
        zod_errors: validation.error.issues,
        correction_attempt: correction,
      }, Date.now() - t0);
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content:
          `Your JSON does not match the required Proposal schema. Errors:\n${validation.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n')}\n\nPlease output a corrected Proposal JSON.`,
      });
      continue;
    }

    const proposal = validation.data;
    emit('PROPOSAL', { proposal, correction_attempt: correction }, Date.now() - t0);

    // ── Verify ────────────────────────────────────────────────────────────────
    const verifyResult = verifyProposal(proposal, session);

    if (verifyResult.approved) {
      emit('VERIFY_PASS', { violations: [] }, Date.now() - t0);
      return { proposal, attempts };
    }

    emit('VERIFY_FAIL', { violations: verifyResult.violations, correction_attempt: correction }, Date.now() - t0);

    // Fatal violation → caller will HANDOFF (no retry)
    if (hasFatalViolation(verifyResult)) {
      return null;  // signal fatal failure
    }

    // Correctable violations — build numbered correction prompt
    if (correction < MAX_CORRECTIONS) {
      const correctionItems = verifyResult.violations
        .map((v, i) => `${i + 1}. [${v.code}] ${v.message}`)
        .join('\n');

      emit('VERIFY_RETRY', { correction_number: correction + 1, violations: verifyResult.violations });

      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content:
          `Your Proposal has ${verifyResult.violations.length} issue(s) that must be fixed:\n\n${correctionItems}\n\nPlease output a corrected Proposal JSON that addresses ALL of the above.`,
      });
    }
  }

  // Exhausted all correction attempts without approval
  return null;
}

// ── Main agent loop ────────────────────────────────────────────────────────────

export interface AgentLoopOptions {
  /** Called for each trace step — use to stream to SSE clients. */
  onTrace: (step: TraceStep) => void;
}

export async function runAgentLoop(
  context: AgentContext,
  session: Session,
  userMessage: string,
  opts: AgentLoopOptions,
): Promise<string> {
  const llm = getLLMClient();
  const stepHistory: StepRecord[] = [];

  let stepIndex = 0;

  function emit(event: TraceEventType, details: unknown, durationMs?: number): void {
    const step: TraceStep = { stepIndex, timestamp: now(), event, details, durationMs };
    opts.onTrace(step);
  }

  emit('START', { userMessage }, 0);

  // System prompt + conversation history (last 12 turns)
  const systemPrompt = buildSystemPrompt(context);
  const historyMessages = context.history.slice(-12);

  // ── Main loop ──────────────────────────────────────────────────────────────

  for (stepIndex = 0; stepIndex < MAX_STEPS; stepIndex++) {
    // Build context suffix showing tool results from this run
    let toolResultsContext = '';
    if (stepHistory.length > 0) {
      const lines = stepHistory.map((s, i) => {
        const action = s.action as NextAction & { tool?: string; args?: unknown };
        let line = `Step ${i + 1}: ${action.action}`;
        if (action.action === 'CALL_TOOL') {
          line += ` tool="${action.tool}" args=${JSON.stringify(action.args)}`;
          if (s.toolResult !== undefined) line += ` → result=${JSON.stringify(s.toolResult).slice(0, 400)}`;
          if (s.toolError) line += ` → ERROR: ${s.toolError}`;
        }
        return line;
      });
      toolResultsContext =
        `\n\n[TOOL RESULTS SO FAR]\n${lines.join('\n')}\n\nNow produce the next Proposal JSON.`;
    }

    const baseMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: userMessage + toolResultsContext },
    ];

    // ── LLM context summary (diagnostic trace) ───────────────────────────────
    {
      const idSlot = context.slots['identity'] as IdentitySlot | undefined;
      emit('LLM_CONTEXT_SUMMARY', {
        identityPresent:  !!idSlot,
        identityConfirmed: idSlot?.confirmedByUser ?? false,
        identityMasked:   idSlot?.maskedFields ?? null,
        checksumValid:    idSlot?.checksumValid ?? null,
        selectedSkillNames:    context.selectedSkills.map((s) => s.name),
        conciergeSnippetsCount: context.conciergeSnippets.length,
      });
    }

    // ── Propose + verify ─────────────────────────────────────────────────────
    const result = await proposeAndVerify(baseMessages, llm, session, emit);

    if (!result) {
      // Either a fatal policy violation or exhausted corrections — check last VERIFY_FAIL
      // to distinguish; for safety always escalate gracefully.
      emit('HANDOFF', { reason: 'Proposal could not be verified after retries or fatal policy violation' });
      emit('FINISH', { outcome: 'handoff' });
      return (
        `I'm connecting you with our front desk team right away.\n\n` +
        `Please call us at ${HOTEL_CONFIG.phone} or visit reception.`
      );
    }

    const { proposal } = result;

    // ── Handle handoff action ────────────────────────────────────────────────
    const handoffAction = proposal.proposed_actions.find((a) => a.type === 'handoff');
    if (handoffAction && handoffAction.type === 'handoff') {
      emit('HANDOFF', { reason: handoffAction.reason });
      emit('FINISH', { outcome: 'handoff' });
      return (
        `${proposal.assistant_message}\n\n` +
        `Please call us at ${HOTEL_CONFIG.phone} or visit the front desk.`
      );
    }

    // ── Execute tool_calls ───────────────────────────────────────────────────
    const toolCalls = proposal.proposed_actions.filter((a) => a.type === 'tool_call');

    if (toolCalls.length === 0) {
      // Respond-only turn — deliver assistant_message
      emit('FINISH', { outcome: 'respond' });
      return proposal.assistant_message;
    }

    // Execute each tool call (policy already verified; at most one per Proposal)
    for (const toolAction of toolCalls) {
      if (toolAction.type !== 'tool_call') continue;

      const t0 = Date.now();
      let toolResult: unknown;

      try {
        toolResult = await executeTool(toolAction.tool, toolAction.args as Record<string, unknown>);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        emit('TOOL_RESULT', { tool: toolAction.tool, error: errMsg }, Date.now() - t0);

        // Store error in step history so LLM sees it next turn
        const fakeAction: NextAction = { action: 'CALL_TOOL', tool: toolAction.tool, args: toolAction.args as Record<string, unknown> };
        stepHistory.push({ action: fakeAction, toolError: errMsg });
        continue;
      }

      emit('TOOL_RESULT', { tool: toolAction.tool, args: toolAction.args, result: toolResult }, Date.now() - t0);
      updateSession(session, toolAction.tool, toolResult);

      const fakeAction: NextAction = { action: 'CALL_TOOL', tool: toolAction.tool, args: toolAction.args as Record<string, unknown> };
      stepHistory.push({ action: fakeAction, toolResult });
    }

    // If the proposal had an assistant_message AND tool calls, the message was a
    // "thinking aloud" message — loop continues so the LLM can finalise after
    // seeing the tool results.  We don't deliver the message yet.
  }

  // Max steps reached
  emit('FINISH', { outcome: 'max_steps' });
  return (
    `I apologise — I was unable to complete your request within the allowed steps. ` +
    `Please speak with our front desk team directly, or call us at ${HOTEL_CONFIG.phone}.`
  );
}

// ── Session state updater ──────────────────────────────────────────────────────

function updateSession(session: Session, tool: string, result: unknown): void {
  const res = result as Record<string, unknown>;

  switch (tool) {
    case 'find_reservation':
      trackReservationResult(session, result);
      if (Array.isArray(res['matches']) && (res['matches'] as unknown[]).length > 0) {
        const first = (res['matches'] as Record<string, unknown>[])[0];
        session.lastReservationId = first['reservationId'] as string;
        session.slots['guestName']      = first['guestName'];
        session.slots['reservationId']  = first['reservationId'];
      }
      break;

    case 'create_reservation':
      if (res['reservationId']) {
        session.lastReservationId = res['reservationId'] as string;
        session.slots['reservationId'] = res['reservationId'];
        session.slots['guestName']     = res['guestName'];
      }
      break;

    case 'book_taxi':
      if (res['bookingId']) {
        session.lastBookingId        = res['bookingId'] as string;
        session.slots['taxiBookingId'] = res['bookingId'];
      }
      break;

    case 'check_in':
    case 'check_out':
      if (res['roomNumber']) session.slots['roomNumber'] = res['roomNumber'];
      break;
  }

  session.lastToolOutput = result;
}
