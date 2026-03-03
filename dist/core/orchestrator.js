"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.orchestrator = exports.Orchestrator = exports.runEventBus = void 0;
const events_1 = require("events");
const sessionStore_1 = require("./sessionStore");
const agentLoop_1 = require("./agentLoop");
const skillLoader_1 = require("./skillLoader");
const conciergeIndex_1 = require("./rag/conciergeIndex");
const hotel_1 = require("../config/hotel");
const elevenlabs_1 = require("../voice/elevenlabs");
// ── Global event bus ───────────────────────────────────────────────────────────
// SSE routes subscribe to these events per run.
exports.runEventBus = new events_1.EventEmitter();
exports.runEventBus.setMaxListeners(500);
// ── Orchestrator class ─────────────────────────────────────────────────────────
class Orchestrator {
    /**
     * Main entry point: process one user message within an existing session.
     * Runs the full agent loop asynchronously and emits SSE events.
     */
    async process(input) {
        const { sessionId, input: userText, voiceEnabled = false } = input;
        // -- Resolve or create session --
        let session = sessionStore_1.sessionStore.getSession(sessionId);
        if (!session) {
            throw new Error(`Session "${sessionId}" not found. Create it via POST /api/session first.`);
        }
        // -- Resolve or create a run record --
        let run = input.runId ? sessionStore_1.sessionStore.getRun(input.runId) : undefined;
        if (!run) {
            run = sessionStore_1.sessionStore.createRun(sessionId, userText);
        }
        const { runId } = run;
        // -- Update run to running --
        sessionStore_1.sessionStore.updateRun(runId, { status: 'running' });
        // -- Emit START --
        this.emitTrace(runId, 0, 'START', { input: userText });
        // -- Assemble context (history does NOT yet contain the current user message —
        //    agentLoop appends it explicitly so it doesn't appear twice in the prompt)
        const context = this.assembleContext(session, userText);
        // -- Run agent loop --
        let output;
        try {
            output = await (0, agentLoop_1.runAgentLoop)(context, session, userText, {
                onTrace: (step) => {
                    // Persist to run trace
                    sessionStore_1.sessionStore.appendTrace(runId, step);
                    // Broadcast to SSE listeners
                    exports.runEventBus.emit(`step:${runId}`, step);
                },
            });
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.emitTrace(runId, -1, 'ERROR', { error: errMsg });
            sessionStore_1.sessionStore.updateRun(runId, {
                status: 'error',
                error: errMsg,
                finishedAt: new Date().toISOString(),
            });
            exports.runEventBus.emit(`done:${runId}`, { error: errMsg });
            throw err;
        }
        // -- Persist turn to conversation history (user then assistant) --
        session.history.push({ role: 'user', content: userText });
        session.history.push({ role: 'assistant', content: output });
        sessionStore_1.sessionStore.updateSession(sessionId, { history: session.history, slots: session.slots });
        // -- Optional TTS --
        let audioBase64;
        if (voiceEnabled) {
            try {
                audioBase64 = await (0, elevenlabs_1.synthesiseSpeechBase64)(output);
            }
            catch (ttsErr) {
                console.error('[Orchestrator] TTS failed (continuing without audio):', ttsErr);
            }
        }
        // -- Emit FINISH --
        this.emitTrace(runId, -1, 'FINISH', { output, hasAudio: !!audioBase64 });
        // -- Finalise run --
        sessionStore_1.sessionStore.updateRun(runId, {
            status: 'done',
            output,
            audioOutputBase64: audioBase64,
            finishedAt: new Date().toISOString(),
        });
        exports.runEventBus.emit(`done:${runId}`, { output });
        return { runId, output, audioBase64 };
    }
    // ── Context assembly ─────────────────────────────────────────────────────────
    assembleContext(session, userText) {
        if (!session)
            throw new Error('Session is undefined in assembleContext');
        // Select relevant skill SOPs based on user query
        const selectedSkills = (0, skillLoader_1.selectSkills)(userText, 2);
        // Retrieve concierge snippets
        const index = (0, conciergeIndex_1.getConciergeIndex)();
        const conciergeSnippets = index.search(userText, 3);
        return {
            hotelConfig: hotel_1.HOTEL_CONFIG,
            selectedSkills,
            conciergeSnippets,
            history: session.history,
            slots: session.slots,
            sessionId: session.sessionId,
        };
    }
    // ── Helpers ──────────────────────────────────────────────────────────────────
    emitTrace(runId, stepIndex, event, details) {
        const step = {
            stepIndex,
            timestamp: new Date().toISOString(),
            event,
            details,
        };
        sessionStore_1.sessionStore.appendTrace(runId, step);
        exports.runEventBus.emit(`step:${runId}`, step);
    }
}
exports.Orchestrator = Orchestrator;
// ── Singleton ──────────────────────────────────────────────────────────────────
exports.orchestrator = new Orchestrator();
//# sourceMappingURL=orchestrator.js.map