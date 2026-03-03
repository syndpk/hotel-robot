/**
 * Orchestrator — the top-level controller for each agent run.
 *
 * Responsibilities:
 *   A) Context assembly: hotel config + relevant skill SOPs + concierge snippets + history.
 *   B) Starts and manages the agent loop (agentLoop.ts).
 *   C) Persists state to the session store.
 *   D) Emits trace steps via the runEventBus (consumed by SSE routes).
 *   E) Optionally calls ElevenLabs TTS on the final response.
 *
 * Usage:
 *   const { output, runId } = await orchestrator.process({
 *     sessionId, input, voiceEnabled
 *   });
 */

import { EventEmitter } from 'events';
import { sessionStore } from './sessionStore';
import { runAgentLoop } from './agentLoop';
import { selectSkills } from './skillLoader';
import { getConciergeIndex } from './rag/conciergeIndex';
import { HOTEL_CONFIG } from '../config/hotel';
import { AgentContext, TraceStep } from './types';
import { synthesiseSpeechBase64 } from '../voice/elevenlabs';

// ── Global event bus ───────────────────────────────────────────────────────────
// SSE routes subscribe to these events per run.

export const runEventBus = new EventEmitter();
runEventBus.setMaxListeners(500);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ProcessInput {
  sessionId: string;
  /** Text input (user-typed or STT transcript). */
  input: string;
  /**
   * Optional: pass a pre-created runId so routes and orchestrator
   * share the same run object (avoids the double-run problem).
   * If omitted, a new run is created internally.
   */
  runId?: string;
  /** If true, synthesise TTS after generating the text response. */
  voiceEnabled?: boolean;
}

export interface ProcessResult {
  runId: string;
  output: string;
  audioBase64?: string;
}

// ── Orchestrator class ─────────────────────────────────────────────────────────

export class Orchestrator {
  /**
   * Main entry point: process one user message within an existing session.
   * Runs the full agent loop asynchronously and emits SSE events.
   */
  async process(input: ProcessInput): Promise<ProcessResult> {
    const { sessionId, input: userText, voiceEnabled = false } = input;

    // -- Resolve or create session --
    let session = sessionStore.getSession(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found. Create it via POST /api/session first.`);
    }

    // -- Resolve or create a run record --
    let run = input.runId ? sessionStore.getRun(input.runId) : undefined;
    if (!run) {
      run = sessionStore.createRun(sessionId, userText);
    }
    const { runId } = run;

    // -- Update run to running --
    sessionStore.updateRun(runId, { status: 'running' });

    // -- Emit START --
    this.emitTrace(runId, 0, 'START', { input: userText });

    // -- Assemble context (history does NOT yet contain the current user message —
    //    agentLoop appends it explicitly so it doesn't appear twice in the prompt)
    const context = this.assembleContext(session, userText);

    // -- Run agent loop --
    let output: string;
    try {
      output = await runAgentLoop(context, session, userText, {
        onTrace: (step: TraceStep) => {
          // Persist to run trace
          sessionStore.appendTrace(runId, step);
          // Broadcast to SSE listeners
          runEventBus.emit(`step:${runId}`, step);
        },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.emitTrace(runId, -1, 'ERROR' as TraceStep['event'], { error: errMsg });
      sessionStore.updateRun(runId, {
        status: 'error',
        error: errMsg,
        finishedAt: new Date().toISOString(),
      });
      runEventBus.emit(`done:${runId}`, { error: errMsg });
      throw err;
    }

    // -- Persist turn to conversation history (user then assistant) --
    session.history.push({ role: 'user', content: userText });
    session.history.push({ role: 'assistant', content: output });
    sessionStore.updateSession(sessionId, { history: session.history, slots: session.slots });

    // -- Optional TTS --
    let audioBase64: string | undefined;
    if (voiceEnabled) {
      try {
        audioBase64 = await synthesiseSpeechBase64(output);
      } catch (ttsErr) {
        console.error('[Orchestrator] TTS failed (continuing without audio):', ttsErr);
      }
    }

    // -- Emit FINISH --
    this.emitTrace(runId, -1, 'FINISH', { output, hasAudio: !!audioBase64 });

    // -- Finalise run --
    sessionStore.updateRun(runId, {
      status: 'done',
      output,
      audioOutputBase64: audioBase64,
      finishedAt: new Date().toISOString(),
    });
    runEventBus.emit(`done:${runId}`, { output });

    return { runId, output, audioBase64 };
  }

  // ── Context assembly ─────────────────────────────────────────────────────────

  private assembleContext(session: ReturnType<typeof sessionStore.getSession>, userText: string): AgentContext {
    if (!session) throw new Error('Session is undefined in assembleContext');

    // Select relevant skill SOPs based on user query
    const selectedSkills = selectSkills(userText, 2);

    // Retrieve concierge snippets
    const index = getConciergeIndex();
    const conciergeSnippets = index.search(userText, 3);

    return {
      hotelConfig: HOTEL_CONFIG,
      selectedSkills,
      conciergeSnippets,
      history: session.history,
      slots: session.slots,
      sessionId: session.sessionId,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private emitTrace(
    runId: string,
    stepIndex: number,
    event: TraceStep['event'],
    details: unknown,
  ): void {
    const step: TraceStep = {
      stepIndex,
      timestamp: new Date().toISOString(),
      event,
      details,
    };
    sessionStore.appendTrace(runId, step);
    runEventBus.emit(`step:${runId}`, step);
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const orchestrator = new Orchestrator();
