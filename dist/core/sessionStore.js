"use strict";
/**
 * Session & Run store.
 * v0: pure in-memory Maps.
 * Interface is designed so a Redis or Postgres adapter can be swapped in
 * by implementing ISessionStore and passing it to the Orchestrator constructor.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionStore = void 0;
const uuid_1 = require("uuid");
// ── In-memory implementation ───────────────────────────────────────────────────
class InMemorySessionStore {
    sessions = new Map();
    runs = new Map();
    createSession() {
        const session = {
            sessionId: (0, uuid_1.v4)(),
            history: [],
            slots: {},
            reservationNotFoundCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.sessions.set(session.sessionId, session);
        return session;
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    updateSession(sessionId, updates) {
        const session = this.sessions.get(sessionId);
        if (session) {
            Object.assign(session, updates);
            session.updatedAt = new Date().toISOString();
        }
    }
    createRun(sessionId, input) {
        const run = {
            runId: (0, uuid_1.v4)(),
            sessionId,
            status: 'pending',
            input,
            trace: [],
            startedAt: new Date().toISOString(),
        };
        this.runs.set(run.runId, run);
        return run;
    }
    getRun(runId) {
        return this.runs.get(runId);
    }
    updateRun(runId, updates) {
        const run = this.runs.get(runId);
        if (run) {
            Object.assign(run, updates);
        }
    }
    appendTrace(runId, step) {
        const run = this.runs.get(runId);
        if (run) {
            run.trace.push(step);
        }
    }
}
// ── Singleton export ───────────────────────────────────────────────────────────
// Replace this with a Redis/Postgres-backed store for production.
exports.sessionStore = new InMemorySessionStore();
//# sourceMappingURL=sessionStore.js.map