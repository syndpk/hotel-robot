/**
 * Session & Run store.
 * v0: pure in-memory Maps.
 * Interface is designed so a Redis or Postgres adapter can be swapped in
 * by implementing ISessionStore and passing it to the Orchestrator constructor.
 */
import { Session, Run, TraceStep } from './types';
export interface ISessionStore {
    createSession(): Session;
    getSession(sessionId: string): Session | undefined;
    updateSession(sessionId: string, updates: Partial<Session>): void;
    createRun(sessionId: string, input: string): Run;
    getRun(runId: string): Run | undefined;
    updateRun(runId: string, updates: Partial<Omit<Run, 'trace'>>): void;
    appendTrace(runId: string, step: TraceStep): void;
}
export declare const sessionStore: ISessionStore;
