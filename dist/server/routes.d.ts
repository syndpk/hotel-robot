/**
 * HTTP routes for the hotel-robot server.
 *
 * REST API:
 *   POST /api/session              — create a new session
 *   POST /api/message              — send text message → returns runId
 *   POST /api/audio                — send audio blob  → STT → agent → TTS → returns runId
 *   GET  /api/runs/:runId          — get run status + output
 *   GET  /api/runs/:runId/events   — SSE stream of run trace steps
 *
 * UI:
 *   GET  /                         — serves ui/index.html
 *   Static files served from /ui/
 */
import { FastifyInstance } from 'fastify';
export declare function registerRoutes(app: FastifyInstance): Promise<void>;
