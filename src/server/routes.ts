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

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sessionStore } from '../core/sessionStore';
import { orchestrator, runEventBus } from '../core/orchestrator';
import { transcribeAudio, checkElevenLabs } from '../voice/elevenlabs';
import { resolvedBackend } from '../llm/llm';
import { parseDocument } from '../identity/passport';
import type { IdentitySlot } from '../core/types';

// ── Route registration ─────────────────────────────────────────────────────────

export async function registerRoutes(app: FastifyInstance): Promise<void> {

  // ── POST /api/session ──────────────────────────────────────────────────────
  app.post('/api/session', async (_req: FastifyRequest, reply: FastifyReply) => {
    const session = sessionStore.createSession();
    return reply.code(201).send({
      sessionId: session.sessionId,
      createdAt: session.createdAt,
    });
  });

  // ── POST /api/message ──────────────────────────────────────────────────────
  interface MessageBody {
    sessionId: string;
    text: string;
    voice?: boolean;  // request TTS on the response
  }

  app.post('/api/message', async (req: FastifyRequest, reply: FastifyReply) => {
    const { sessionId, text, voice = false } = req.body as MessageBody;

    if (!sessionId || typeof sessionId !== 'string') {
      return reply.code(400).send({ error: 'sessionId is required.' });
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      return reply.code(400).send({ error: 'text message is required.' });
    }

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return reply.code(404).send({ error: `Session "${sessionId}" not found.` });
    }

    // Create run immediately and return runId; processing is async
    const run = sessionStore.createRun(sessionId, text.trim());

    // Fire-and-forget — pass runId so orchestrator reuses this run (no duplicate)
    setImmediate(() => {
      orchestrator.process({ sessionId, input: text.trim(), voiceEnabled: voice, runId: run.runId }).catch((err) => {
        console.error('[routes] Orchestrator error:', err);
      });
    });

    return reply.code(202).send({ runId: run.runId });
  });

  // ── POST /api/audio ────────────────────────────────────────────────────────
  app.post('/api/audio', async (req: FastifyRequest, reply: FastifyReply) => {
    const data = await (req as FastifyRequest & { file: () => Promise<import('@fastify/multipart').MultipartFile> }).file();

    if (!data) {
      return reply.code(400).send({ error: 'No audio file uploaded.' });
    }

    const query = req.query as Record<string, string>;
    const sessionId = query['sessionId'];
    if (!sessionId) {
      return reply.code(400).send({ error: 'sessionId query parameter is required.' });
    }
    // Optional BCP-47 language hint forwarded from the UI language selector.
    // Falls back to STT_LANGUAGE env var (default 'en') inside transcribeAudio.
    const langHint = query['lang'] || undefined;

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return reply.code(404).send({ error: `Session "${sessionId}" not found.` });
    }

    // Collect audio bytes
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer);
    }
    const audioBuffer = Buffer.concat(chunks);
    const mimeType = data.mimetype || 'audio/webm';

    // Transcribe via ElevenLabs STT
    let transcript: string;
    try {
      const sttResult = await transcribeAudio(audioBuffer, mimeType, langHint);
      transcript = sttResult.transcript.trim();
    } catch (sttErr) {
      const detail = sttErr instanceof Error ? sttErr.message : String(sttErr);
      app.log.error({ detail }, '[routes] ElevenLabs STT failed');
      return reply.code(502).send({
        code: 'ELEVENLABS_STT_FAILED',
        error: 'Speech-to-text failed. Please try again.',
        detail,
      });
    }

    if (!transcript) {
      return reply.code(422).send({ error: 'Could not detect speech in the audio. Please try again.' });
    }

    // Create run and start orchestration
    const run = sessionStore.createRun(sessionId, transcript);

    setImmediate(() => {
      orchestrator.process({
        sessionId,
        input: transcript,
        voiceEnabled: true,   // audio input always gets audio output
        runId: run.runId,     // reuse the pre-created run (no duplicate)
      }).catch((err) => {
        console.error('[routes] Orchestrator error (audio):', err);
      });
    });

    return reply.code(202).send({ runId: run.runId, transcript });
  });

  // ── GET /api/runs/:runId ───────────────────────────────────────────────────
  app.get('/api/runs/:runId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { runId } = req.params as { runId: string };
    const run = sessionStore.getRun(runId);
    if (!run) {
      return reply.code(404).send({ error: `Run "${runId}" not found.` });
    }
    // Don't include large audio in polling endpoint
    const { audioOutputBase64: _audio, ...runSummary } = run;
    return reply.send({
      ...runSummary,
      hasAudio: !!_audio,
    });
  });

  // ── GET /api/runs/:runId/audio ─────────────────────────────────────────────
  app.get('/api/runs/:runId/audio', async (req: FastifyRequest, reply: FastifyReply) => {
    const { runId } = req.params as { runId: string };
    const run = sessionStore.getRun(runId);
    if (!run) return reply.code(404).send({ error: 'Run not found.' });
    if (!run.audioOutputBase64) return reply.code(404).send({ error: 'No audio for this run.' });

    const buf = Buffer.from(run.audioOutputBase64, 'base64');
    return reply
      .header('Content-Type', 'audio/mpeg')
      .header('Content-Length', buf.length)
      .send(buf);
  });

  // ── GET /api/runs/:runId/events (SSE) ──────────────────────────────────────
  app.get('/api/runs/:runId/events', (req: FastifyRequest, reply: FastifyReply) => {
    const { runId } = req.params as { runId: string };

    const res = reply.raw;

    // @fastify/cors does NOT apply CORS headers after reply.hijack() because
    // Fastify's response lifecycle is bypassed.  Set them manually here so
    // EventSource connections from cross-origin UIs (e.g. :5173) are allowed.
    const reqOrigin = req.headers.origin;
    if (reqOrigin) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.writeHead(200);

    // Hijack so Fastify doesn't manage the response
    reply.hijack();

    function sendEvent(event: string, data: unknown): void {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    function sendStep(step: unknown): void {
      res.write(`data: ${JSON.stringify(step)}\n\n`);
    }

    // Send any steps already recorded (client may connect after processing starts)
    const existingRun = sessionStore.getRun(runId);
    if (existingRun) {
      for (const step of existingRun.trace) {
        sendStep(step);
      }
      if (existingRun.status === 'done' || existingRun.status === 'error') {
        sendEvent('done', { status: existingRun.status, output: existingRun.output });
        res.end();
        return;
      }
    }

    // Subscribe to new steps
    const onStep = (step: unknown) => sendStep(step);
    const onDone = (payload: unknown) => {
      sendEvent('done', payload);
      cleanup();
      res.end();
    };

    runEventBus.on(`step:${runId}`, onStep);
    runEventBus.once(`done:${runId}`, onDone);

    // Keepalive ping every 20 s to prevent proxy timeouts
    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 20_000);

    function cleanup(): void {
      clearInterval(keepAlive);
      runEventBus.off(`step:${runId}`, onStep);
      runEventBus.off(`done:${runId}`, onDone);
    }

    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });

  // ── POST /api/passport ─────────────────────────────────────────────────────
  // Accepts a multipart image upload; processes it with local OCR + MRZ parsing;
  // stores masked result in session.slots.identity (confirmedByUser=false).

  app.post('/api/passport', async (req: FastifyRequest, reply: FastifyReply) => {
    const data = await (req as FastifyRequest & { file: () => Promise<import('@fastify/multipart').MultipartFile> }).file();

    if (!data) {
      return reply.code(400).send({ error: 'No image file uploaded.' });
    }

    const query = req.query as Record<string, string>;
    const sessionId = query['sessionId'];
    if (!sessionId) {
      return reply.code(400).send({ error: 'sessionId query parameter is required.' });
    }

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return reply.code(404).send({ error: `Session "${sessionId}" not found.` });
    }

    // Collect all image bytes, enforcing max size
    const maxMb = parseInt(process.env['DOCUMENT_MAX_FILE_MB'] ?? '5', 10);
    const maxBytes = maxMb * 1024 * 1024;
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer);
    }
    const imageBuffer = Buffer.concat(chunks);

    if (imageBuffer.length > maxBytes) {
      return reply.code(413).send({ error: `Image too large. Maximum is ${maxMb} MB.` });
    }
    if (imageBuffer.length === 0) {
      return reply.code(400).send({ error: 'Empty image file.' });
    }

    // Parse document locally — no image buffer is stored
    let parseResult: Awaited<ReturnType<typeof parseDocument>>;
    try {
      parseResult = await parseDocument(imageBuffer);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      app.log.error({ detail }, '[passport] parseDocument failed');
      return reply.code(500).send({ error: 'Document processing failed.', detail });
    }

    // Store in session (confirmedByUser=false until /api/passport/confirm is called)
    const identitySlot: IdentitySlot = {
      maskedFields: parseResult.maskedFields,
      validationStatus: parseResult.validation,
      confidences: { overall: parseResult.confidences.overall },
      checksumValid: parseResult.validation.mrzChecksumPassed,
      confirmedByUser: false,
      capturedAt: new Date().toISOString(),
    };
    session.slots['identity'] = identitySlot;
    sessionStore.updateSession(sessionId, { slots: session.slots });

    return reply.send({
      ok: parseResult.ok,
      maskedFields: parseResult.maskedFields,
      confidences: parseResult.confidences,
      validation: parseResult.validation,
      errors: parseResult.errors,
    });
  });

  // ── POST /api/passport/confirm ─────────────────────────────────────────────
  // Guest has reviewed the extracted fields and confirms they are correct.
  // Sets confirmedByUser=true, enabling the agent to use the identity data.

  interface PassportConfirmBody { sessionId: string; }

  app.post('/api/passport/confirm', async (req: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = req.body as PassportConfirmBody;

    if (!sessionId || typeof sessionId !== 'string') {
      return reply.code(400).send({ error: 'sessionId is required.' });
    }

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return reply.code(404).send({ error: `Session "${sessionId}" not found.` });
    }

    const identity = session.slots['identity'] as IdentitySlot | undefined;
    if (!identity) {
      return reply.code(404).send({ error: 'No document has been captured for this session yet.' });
    }

    identity.confirmedByUser = true;
    sessionStore.updateSession(sessionId, { slots: session.slots });

    return reply.send({ ok: true, confirmedAt: new Date().toISOString() });
  });

  // ── Health check ───────────────────────────────────────────────────────────

  /** Lightweight server-liveness probe (used by UI status dot). */
  app.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok', time: new Date().toISOString() });
  });

  /**
   * Detailed health check — validates the ElevenLabs API key with a real
   * lightweight call (GET /v1/user).  Useful for diagnosing voice failures.
   * Not intended as a high-frequency liveness probe.
   */
  app.get('/api/health', async (_req, reply) => {
    const elevenlabs = await checkElevenLabs();
    const backend = resolvedBackend();
    const allOk = elevenlabs.ok;
    return reply.code(allOk ? 200 : 503).send({
      status: allOk ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      llm_backend: backend,
      ...(backend === 'llamacpp' && {
        llamacpp_endpoint: process.env.LLAMACPP_ENDPOINT ?? 'http://localhost:8080',
      }),
      services: {
        elevenlabs: {
          ok: elevenlabs.ok,
          detail: elevenlabs.detail,
        },
      },
    });
  });

  // ── Static UI ──────────────────────────────────────────────────────────────
  // Served by @fastify/static registered in index.ts
  app.get('/', async (_req, reply) => {
    return reply.sendFile('index.html');
  });
}
