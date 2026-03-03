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
export declare const runEventBus: EventEmitter<[never]>;
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
export declare class Orchestrator {
    /**
     * Main entry point: process one user message within an existing session.
     * Runs the full agent loop asynchronously and emits SSE events.
     */
    process(input: ProcessInput): Promise<ProcessResult>;
    private assembleContext;
    private emitTrace;
}
export declare const orchestrator: Orchestrator;
