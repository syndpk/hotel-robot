/**
 * Session & Run store.
 * v0: pure in-memory Maps.
 * Interface is designed so a Redis or Postgres adapter can be swapped in
 * by implementing ISessionStore and passing it to the Orchestrator constructor.
 */

import { v4 as uuidv4 } from 'uuid';
import { Session, Run, TraceStep, RunStatus } from './types';

// ── Interface ──────────────────────────────────────────────────────────────────

export interface ISessionStore {
  createSession(): Session;
  getSession(sessionId: string): Session | undefined;
  updateSession(sessionId: string, updates: Partial<Session>): void;

  createRun(sessionId: string, input: string): Run;
  getRun(runId: string): Run | undefined;
  updateRun(runId: string, updates: Partial<Omit<Run, 'trace'>>): void;
  appendTrace(runId: string, step: TraceStep): void;
}

// ── In-memory implementation ───────────────────────────────────────────────────

class InMemorySessionStore implements ISessionStore {
  private sessions = new Map<string, Session>();
  private runs = new Map<string, Run>();

  createSession(): Session {
    const session: Session = {
      sessionId: uuidv4(),
      history: [],
      slots: {},
      reservationNotFoundCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  updateSession(sessionId: string, updates: Partial<Session>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates);
      session.updatedAt = new Date().toISOString();
    }
  }

  createRun(sessionId: string, input: string): Run {
    const run: Run = {
      runId: uuidv4(),
      sessionId,
      status: 'pending',
      input,
      trace: [],
      startedAt: new Date().toISOString(),
    };
    this.runs.set(run.runId, run);
    return run;
  }

  getRun(runId: string): Run | undefined {
    return this.runs.get(runId);
  }

  updateRun(runId: string, updates: Partial<Omit<Run, 'trace'>>): void {
    const run = this.runs.get(runId);
    if (run) {
      Object.assign(run, updates);
    }
  }

  appendTrace(runId: string, step: TraceStep): void {
    const run = this.runs.get(runId);
    if (run) {
      run.trace.push(step);
    }
  }
}

// ── Singleton export ───────────────────────────────────────────────────────────
// Replace this with a Redis/Postgres-backed store for production.

export const sessionStore: ISessionStore = new InMemorySessionStore();
