/**
 * Hotel Receptionist Voice Agent — UI
 *
 * Features:
 *   - Text messaging with Enter key or Send button
 *   - Push-to-talk audio recording (MediaRecorder API)
 *   - SSE streaming for real-time agent trace display
 *   - Audio playback of TTS responses
 *   - Session persistence (sessionStorage)
 *
 * ── API Base URL resolution (priority order) ──────────────────────────────
 *   1. ?apiBase=http://localhost:3000  in the URL query string
 *      → persisted to sessionStorage for the rest of the session
 *   2. sessionStorage key "hotelRobotApiBase" (set by option 1 previously)
 *   3. Auto-detect: if the page is served from a port other than 3000
 *      AND on localhost, assume the backend is at http://localhost:3000
 *   4. Empty string → same-origin (when served by the Fastify backend itself)
 *
 * Examples:
 *   http://localhost:3000/            → same-origin, no config needed
 *   http://localhost:5173/            → auto-detects http://localhost:3000
 *   http://localhost:5173/?apiBase=http://localhost:4000  → custom backend
 */

// ── API base resolution ────────────────────────────────────────────────────────

function resolveApiBase() {
  const params = new URLSearchParams(window.location.search);
  const qp = params.get('apiBase');

  if (qp) {
    // Persist for the session so subsequent page loads don't need the param
    const clean = qp.replace(/\/$/, '');
    sessionStorage.setItem('hotelRobotApiBase', clean);
    return clean;
  }

  const stored = sessionStorage.getItem('hotelRobotApiBase');
  if (stored) return stored;

  // Auto-detect: page served from a port that isn't the backend port
  if (window.location.hostname === 'localhost' && window.location.port !== '3000') {
    return 'http://localhost:3000';
  }

  // Same-origin (Fastify serves both UI and API)
  return '';
}

const API_BASE = resolveApiBase();

// ── State ──────────────────────────────────────────────────────────────────────

let sessionId = null;
let voiceEnabled = true;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let currentEventSource = null;

// ── DOM refs ───────────────────────────────────────────────────────────────────

const transcript      = document.getElementById('transcript');
const textInput       = document.getElementById('textInput');
const sendBtn         = document.getElementById('sendBtn');
const pttBtn          = document.getElementById('pttBtn');
const pttIcon         = document.getElementById('pttIcon');
const pttLabel        = document.getElementById('pttLabel');
const voiceToggle     = document.getElementById('voiceToggle');
const langSelect      = document.getElementById('langSelect');
const typingIndicator = document.getElementById('typingIndicator');
const traceLog        = document.getElementById('traceLog');
const clearTraceBtn   = document.getElementById('clearTrace');
const statusDot       = document.getElementById('statusDot');
const apiBaseLabel    = document.getElementById('apiBaseLabel');
// Trace panel toggle
const tracePanel      = document.getElementById('tracePanel');
const traceToggleBtn  = document.getElementById('traceToggleBtn');
const traceChevron    = document.getElementById('traceChevron');
const traceBackdrop   = document.getElementById('traceBackdrop');
const traceCloseBtn   = document.getElementById('traceCloseBtn');

// Show resolved base URL in header
if (apiBaseLabel) {
  apiBaseLabel.textContent = API_BASE || '(same-origin)';
  apiBaseLabel.title = `All API calls → ${API_BASE || window.location.origin}`;
}

// ── Safe fetch helpers ─────────────────────────────────────────────────────────

/**
 * Extract a user-readable error string from a non-ok fetch Response.
 * Handles both JSON `{ error: "..." }` bodies and plain HTML/text error pages.
 */
async function readErrorBody(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      const j = await res.json();
      return j.error || j.message || `HTTP ${res.status}`;
    } catch (_) {}
  }
  try {
    const text = await res.text();
    // Strip HTML tags for readability
    const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return `HTTP ${res.status}${plain ? ': ' + plain.slice(0, 100) : ''}`;
  } catch (_) {}
  return `HTTP ${res.status}`;
}

/**
 * Typed fetch error — carries the HTTP status so callers can branch on it
 * without fragile string matching.
 */
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * fetch() wrapper that throws ApiError on non-2xx responses.
 * Prevents "Unexpected token <" when the server returns an HTML error page.
 */
async function apiFetch(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, opts);
  if (!res.ok) {
    const msg = await readErrorBody(res);
    throw new ApiError(msg, res.status);
  }
  return res;
}

// ── Session recovery helpers ───────────────────────────────────────────────────

/**
 * Called when the server returns 404 "Session not found" — the server was
 * most likely restarted (in-memory store wiped).  Creates a fresh session and
 * updates the module-level sessionId so any retry closure sees the new value.
 */
async function recreateSession() {
  sessionStorage.removeItem('hotelRobotSessionId');
  sessionId = null;

  // Show a subtle inline notice so the user understands the pause
  const notice = document.createElement('div');
  notice.className = 'msg agent';
  notice.innerHTML =
    '<div class="bubble" style="font-size:0.8rem;opacity:0.65">' +
    'ℹ️ Session reset (server restarted). Reconnecting…</div>';
  transcript.appendChild(notice);
  transcript.scrollTop = transcript.scrollHeight;

  const res = await apiFetch('/api/session', { method: 'POST' });
  const data = await res.json();
  sessionId = data.sessionId;
  sessionStorage.setItem('hotelRobotSessionId', sessionId);
  setConnected(true);
}

/**
 * Run `fn`.  If it throws ApiError with status 404, assume a stale session,
 * call recreateSession(), then run `fn` a second time.
 * Any error on the retry propagates normally (no infinite loop).
 */
async function withSessionRecovery(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      await recreateSession();
      return await fn();          // retry once with the new sessionId
    }
    throw e;
  }
}

// ── Initialisation ─────────────────────────────────────────────────────────────

async function init() {
  sessionId = sessionStorage.getItem('hotelRobotSessionId');

  if (sessionId) {
    // We have a stored session — optimistically mark as connected, then do a
    // background health ping so the status dot accurately reflects server state.
    // Stale sessions are handled lazily by withSessionRecovery on first message.
    setConnected(true);
    pingHealth();
    return;
  }

  // No stored session — create one now
  try {
    const res = await apiFetch('/api/session', { method: 'POST' });
    const data = await res.json();
    if (!data.sessionId) throw new Error('Server returned no sessionId');
    sessionId = data.sessionId;
    sessionStorage.setItem('hotelRobotSessionId', sessionId);
    setConnected(true);
  } catch (e) {
    setConnected(false);
    showError(
      `Could not connect to the backend at <strong>${API_BASE || window.location.origin}</strong>.<br>` +
      `Make sure the server is running (<code>npm run dev</code>) and try refreshing.<br>` +
      `<small>If the UI is on a different port, add <code>?apiBase=http://localhost:3000</code> to the URL.</small>`,
      true /* html */
    );
    console.error('Session creation failed:', e);
  }
}

/** Background server health check — updates the status dot without blocking UI. */
async function pingHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    setConnected(res.ok);
  } catch (_) {
    setConnected(false);
  }
}

function setConnected(ok) {
  statusDot.classList.toggle('connected', ok);
  statusDot.title = ok ? `Connected to ${API_BASE || 'same-origin'}` : 'Disconnected';
}

// ── Text messaging ─────────────────────────────────────────────────────────────

async function sendText() {
  const text = textInput.value.trim();
  if (!text || !sessionId) return;

  textInput.value = '';
  addMessage('user', text);
  setThinking(true);

  try {
    // withSessionRecovery auto-recreates the session if the server was restarted
    // (404 "Session not found") and retries the message once.
    await withSessionRecovery(async () => {
      const res = await apiFetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text, voice: voiceEnabled }),
      });
      const { runId } = await res.json();
      await streamRun(runId, voiceEnabled);
    });
  } catch (e) {
    setThinking(false);
    addMessage('agent', `⚠️ ${e.message || 'Connection error. Is the server running?'}`, null);
    console.error('sendText error:', e);
  }
}

sendBtn.addEventListener('click', sendText);
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
});

// ── Voice toggle ───────────────────────────────────────────────────────────────

voiceToggle.addEventListener('click', () => {
  voiceEnabled = !voiceEnabled;
  voiceToggle.classList.toggle('active', voiceEnabled);
  voiceToggle.textContent = voiceEnabled ? '🔊 Voice reply' : '🔇 Voice reply';
});

// ── Push-to-talk ───────────────────────────────────────────────────────────────

async function startRecording() {
  if (isRecording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    const mime = getSupportedMime();
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      await sendAudio(blob, mediaRecorder.mimeType || 'audio/webm');
    };

    mediaRecorder.start(100); // collect in 100 ms chunks
    isRecording = true;
    pttBtn.classList.add('recording');
    pttIcon.textContent = '⏺';
    pttLabel.textContent = 'Recording… release to send';
  } catch (e) {
    const msg = e.name === 'NotAllowedError'
      ? 'Microphone access denied. Allow microphone access in your browser settings and try again.'
      : `Microphone error: ${e.message}`;
    addMessage('agent', `⚠️ ${msg}`, null);
    console.error('startRecording error:', e);
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  isRecording = false;
  pttBtn.classList.remove('recording');
  pttIcon.textContent = '🎤';
  pttLabel.textContent = 'Hold to speak';
}

function getSupportedMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

// Mouse events
pttBtn.addEventListener('mousedown', startRecording);
pttBtn.addEventListener('mouseup', stopRecording);
pttBtn.addEventListener('mouseleave', stopRecording);

// Touch events (mobile)
pttBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
pttBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });

// ── Audio send ─────────────────────────────────────────────────────────────────

async function sendAudio(blob, mimeType) {
  if (!sessionId) return;
  setThinking(true);

  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
  const formData = new FormData();
  formData.append('audio', blob, `recording.${ext}`);

  try {
    // withSessionRecovery auto-recreates the session if the server was restarted
    // (404 "Session not found") and retries the upload once with the new sessionId.
    await withSessionRecovery(async () => {
      const lang = langSelect ? langSelect.value : 'en';
      const res = await apiFetch(
        `/api/audio?sessionId=${encodeURIComponent(sessionId)}&lang=${encodeURIComponent(lang)}`,
        { method: 'POST', body: formData },
      );
      const { runId, transcript: sttText } = await res.json();

      // Show transcribed text as user message
      if (sttText) addMessage('user', `🎤 ${sttText}`);

      await streamRun(runId, true);
    });
  } catch (e) {
    setThinking(false);
    addMessage('agent', `⚠️ ${e.message || 'Audio upload failed.'}`, null);
    console.error('sendAudio error:', e);
  }
}

// ── SSE streaming ──────────────────────────────────────────────────────────────

function streamRun(runId, isVoice) {
  return new Promise((resolve) => {
    if (currentEventSource) currentEventSource.close();

    // EventSource does not support custom headers but cross-origin SSE works
    // as long as the server sends CORS headers (our Fastify does).
    const es = new EventSource(`${API_BASE}/api/runs/${runId}/events`);
    currentEventSource = es;

    es.onmessage = (e) => {
      try { addTraceStep(JSON.parse(e.data)); } catch (_) {}
    };

    es.addEventListener('done', async (e) => {
      es.close();
      currentEventSource = null;
      setThinking(false);

      let payload = {};
      try { payload = JSON.parse(e.data); } catch (_) {}

      if (payload.output) {
        let audioSrc = null;
        if (isVoice || voiceEnabled) {
          try {
            const audioRes = await fetch(`${API_BASE}/api/runs/${runId}/audio`);
            if (audioRes.ok) audioSrc = URL.createObjectURL(await audioRes.blob());
          } catch (_) {}
        }
        addMessage('agent', payload.output, audioSrc);
      } else if (payload.error) {
        addMessage('agent', `⚠️ Agent error: ${payload.error}`, null);
      }

      resolve();
    });

    es.onerror = () => {
      // SSE errors include CORS failures and network issues.
      // Fall back to polling so the conversation still completes.
      es.close();
      currentEventSource = null;
      setThinking(false);
      pollRun(runId, isVoice).then(resolve);
    };

    // Hard timeout: 45 s
    const timer = setTimeout(() => {
      if (currentEventSource === es) {
        es.close();
        currentEventSource = null;
        setThinking(false);
        resolve();
      }
    }, 45_000);

    // Cancel timer if done fires first
    es.addEventListener('done', () => clearTimeout(timer), { once: true });
  });
}

// ── Polling fallback (used when SSE fails) ─────────────────────────────────────

async function pollRun(runId, isVoice, attempts = 0) {
  if (attempts > 40) return;
  await sleep(750);

  try {
    const res = await fetch(`${API_BASE}/api/runs/${runId}`);
    if (!res.ok) { await sleep(1000); return pollRun(runId, isVoice, attempts + 1); }

    const run = await res.json();

    if (run.status === 'done') {
      setThinking(false);
      let audioSrc = null;
      if ((isVoice || voiceEnabled) && run.hasAudio) {
        const audioRes = await fetch(`${API_BASE}/api/runs/${runId}/audio`);
        if (audioRes.ok) audioSrc = URL.createObjectURL(await audioRes.blob());
      }
      if (run.output) addMessage('agent', run.output, audioSrc);
    } else if (run.status === 'error') {
      setThinking(false);
      addMessage('agent', `⚠️ ${run.error || 'Agent error.'}`, null);
    } else {
      await pollRun(runId, isVoice, attempts + 1);
    }
  } catch (e) {
    console.error('pollRun error:', e);
    await pollRun(runId, isVoice, attempts + 1);
  }
}

// ── UI helpers ─────────────────────────────────────────────────────────────────

function addMessage(role, text, audioSrc) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  if (audioSrc) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.autoplay = true;
    audio.src = audioSrc;
    bubble.appendChild(audio);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = role === 'user' ? 'You' : `Reception Assistant · ${timeStr()}`;

  div.appendChild(bubble);
  div.appendChild(meta);
  transcript.appendChild(div);
  transcript.scrollTop = transcript.scrollHeight;
}

/**
 * Show a prominent error banner inside the transcript area.
 * @param {string} html - HTML or plain-text content
 * @param {boolean} isHtml - if true, set innerHTML instead of textContent
 */
function showError(html, isHtml = false) {
  const div = document.createElement('div');
  div.className = 'msg agent';
  const bubble = document.createElement('div');
  bubble.className = 'bubble error-bubble';
  if (isHtml) bubble.innerHTML = `⚠️ ${html}`;
  else bubble.textContent = `⚠️ ${html}`;
  div.appendChild(bubble);
  transcript.appendChild(div);
  transcript.scrollTop = transcript.scrollHeight;
}

function setThinking(active) {
  typingIndicator.classList.toggle('visible', active);
  sendBtn.disabled = active;
  pttBtn.disabled = active;
  if (active) transcript.scrollTop = transcript.scrollHeight;
}

// ── Trace panel ────────────────────────────────────────────────────────────────

const EVENT_COLORS = {
  START:       '#888',
  FINISH:      '#4caf72',
  // Proposal loop
  PROPOSAL:    '#26c6da',
  VERIFY_PASS: '#4caf72',
  VERIFY_FAIL: '#ff9f43',
  VERIFY_RETRY:'#ffcc02',
  // Tool execution
  TOOL_RESULT: '#9c6fff',
  // Outcomes
  HANDOFF:     '#e05252',
  // Diagnostic
  LLM_CONTEXT_SUMMARY:   '#7986cb',
  // Identity / document events
  DOCUMENT_CAPTURED:     '#42a5f5',
  DOCUMENT_EXTRACTED:    '#26c6da',
  DOCUMENT_VALIDATION:   '#ffcc02',
  DOCUMENT_CONFIRMATION: '#4caf72',
  // Errors
  ERROR:       '#e05252',
  PARSE_ERROR: '#e05252',
};

function addTraceStep(step) {
  const div = document.createElement('div');
  div.className = `trace-step ${step.event ?? ''}`;

  const name = document.createElement('div');
  name.className = 'event-name';
  name.style.color = EVENT_COLORS[step.event] || '#aaa';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'event-time';
  timeSpan.textContent = step.durationMs != null ? `${step.durationMs}ms` : timeStr();

  name.textContent = step.event || 'STEP';
  name.appendChild(timeSpan);

  const body = document.createElement('div');
  body.className = 'event-body';
  body.textContent = summariseStep(step);

  const detail = document.createElement('div');
  detail.className = 'trace-detail';
  detail.textContent = JSON.stringify(step.details, null, 2);

  div.appendChild(name);
  div.appendChild(body);
  div.appendChild(detail);

  div.addEventListener('click', () => div.classList.toggle('expanded'));

  traceLog.appendChild(div);
  traceLog.scrollTop = traceLog.scrollHeight;
}

function summariseStep(step) {
  const d = step.details || {};
  switch (step.event) {
    case 'START':
      return `Input: "${String(d.userMessage || d.input || '').slice(0, 60)}"`;
    case 'PROPOSAL': {
      const p = d.proposal || {};
      const nActions = (p.proposed_actions || []).length;
      const msg = String(p.assistant_message || '').slice(0, 60);
      const retry = d.correction_attempt > 0 ? ` (retry #${d.correction_attempt})` : '';
      return `${nActions} action(s)${retry} · "${msg}"`;
    }
    case 'VERIFY_PASS':
      return 'Approved — no violations';
    case 'VERIFY_FAIL': {
      const vs = (d.violations || []).map((v) => v.code).join(', ');
      return `${(d.violations || []).length} violation(s): ${vs}`;
    }
    case 'VERIFY_RETRY':
      return `Correction #${d.correction_number}: ${(d.violations || []).map((v) => v.code).join(', ')}`;
    case 'TOOL_RESULT':
      return `← ${d.tool || ''}: ${JSON.stringify(d.result || d.error || {}).slice(0, 80)}`;
    case 'HANDOFF':
      return `Reason: ${String(d.reason || '').slice(0, 80)}`;
    case 'FINISH':
      return `Outcome: ${d.outcome || '?'}`;
    case 'PARSE_ERROR':
      return `Parse failed (attempt ${d.correction_attempt ?? '?'}): ${String(d.raw_model_output || '').slice(0, 60)}`;
    case 'LLM_CONTEXT_SUMMARY': {
      const parts = [
        `skills:[${(d.selectedSkillNames || []).join(', ') || 'none'}]`,
        `rag:${d.conciergeSnippetsCount ?? 0}`,
      ];
      if (d.identityPresent) {
        const f = d.identityMasked || {};
        const who = f.fullName || f.surname || '?';
        parts.push(`id:${d.identityConfirmed ? '✓' : '⏳'} ${who} chk:${d.checksumValid ? '✓' : '✗'}`);
      } else {
        parts.push('id:none');
      }
      return parts.join(' · ');
    }
    case 'DOCUMENT_CAPTURED':
      return `Image received (${d.mimeType || 'unknown'}, ${d.sizeBytes ? Math.round(d.sizeBytes / 1024) + ' KB' : '?'})`;
    case 'DOCUMENT_EXTRACTED': {
      const fields = d.maskedFields || {};
      const name = [fields.surname, fields.givenNames].filter(Boolean).join(', ') || '—';
      return `Extracted: ${name} · confidence ${d.confidence != null ? Math.round(d.confidence * 100) + '%' : '?'}`;
    }
    case 'DOCUMENT_VALIDATION':
      return `MRZ checksum: ${d.mrzChecksumPassed ? '✓ passed' : '✗ failed'} · doc type: ${d.documentType || '?'}`;
    case 'DOCUMENT_CONFIRMATION':
      return `Guest confirmed identity · confirmedAt: ${d.confirmedAt || '?'}`;
    case 'ERROR':
      return String(d.detail || d.error || '').slice(0, 80);
    default:
      return JSON.stringify(d).slice(0, 80);
  }
}

clearTraceBtn.addEventListener('click', () => { traceLog.innerHTML = ''; });

// ── Agent Trace panel toggle ────────────────────────────────────────────────────

const TRACE_KEY = 'hotelRobotTraceOpen';

/** Returns true when the viewport is wider than the mobile breakpoint. */
function isDesktop() {
  return window.matchMedia('(min-width: 900px)').matches;
}

function openTrace() {
  tracePanel.classList.add('open');
  traceToggleBtn.classList.add('active');
  traceChevron.textContent = '◂';
  if (!isDesktop()) {
    // Mobile: show backdrop and prevent background scroll
    traceBackdrop.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }
  localStorage.setItem(TRACE_KEY, '1');
}

function closeTrace() {
  tracePanel.classList.remove('open');
  traceToggleBtn.classList.remove('active');
  traceChevron.textContent = '▸';
  traceBackdrop.classList.remove('visible');
  document.body.style.overflow = '';
  localStorage.setItem(TRACE_KEY, '0');
}

function toggleTrace() {
  if (tracePanel.classList.contains('open')) closeTrace();
  else openTrace();
}

/**
 * Read the persisted trace open/closed preference.
 * Default: closed (panel is always collapsed until the user explicitly opens it).
 */
function initTrace() {
  const stored = localStorage.getItem(TRACE_KEY);
  if (stored === '1') openTrace();
  else closeTrace();
}

traceToggleBtn.addEventListener('click', toggleTrace);
traceCloseBtn.addEventListener('click', closeTrace);
traceBackdrop.addEventListener('click', closeTrace);

// When resizing from mobile → desktop, remove mobile-only overlay state
window.addEventListener('resize', () => {
  if (isDesktop()) {
    traceBackdrop.classList.remove('visible');
    document.body.style.overflow = '';
  }
});

// ── ID Scan Modal ───────────────────────────────────────────────────────────────

const idModal       = document.getElementById('idModal');
const idModalClose  = document.getElementById('idModalClose');
const tabUpload     = document.getElementById('tabUpload');
const tabCamera     = document.getElementById('tabCamera');
const panelUpload   = document.getElementById('panelUpload');
const panelCamera   = document.getElementById('panelCamera');
const idDropZone    = document.getElementById('idDropZone');
const idFileInput   = document.getElementById('idFileInput');
const idVideo       = document.getElementById('idVideo');
const idCanvas      = document.getElementById('idCanvas');
const idCaptureBtn  = document.getElementById('idCaptureBtn');
const idPreviewWrap = document.getElementById('idPreviewWrap');
const idPreviewImg  = document.getElementById('idPreviewImg');
const idRetakeBtn   = document.getElementById('idRetakeBtn');
const idStatus      = document.getElementById('idStatus');
const idResults     = document.getElementById('idResults');
const idFieldsTable = document.getElementById('idFieldsTable');
const idSubmitBtn   = document.getElementById('idSubmitBtn');
const idConfirmBtn  = document.getElementById('idConfirmBtn');
const idScanBtn     = document.getElementById('idScanBtn');

let idImageBlob  = null;   // { blob, mimeType }
let cameraStream = null;   // active getUserMedia stream

// ── Open / close ──────────────────────────────────────────────────────────────

function openIdModal() {
  resetIdModal();
  switchIdTab('upload');
  idModal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeIdModal() {
  idModal.classList.remove('open');
  document.body.style.overflow = '';
  stopCamera();
}

function resetIdModal() {
  idImageBlob = null;
  idPreviewWrap.classList.add('id-preview-wrap--hidden');
  idResults.classList.add('id-results--hidden');
  idConfirmBtn.classList.add('id-confirm-btn--hidden');
  idConfirmBtn.disabled = false;
  idSubmitBtn.disabled = true;
  idSubmitBtn.textContent = '🔍 Extract Info';
  idStatus.textContent = '';
  idStatus.className = 'id-status';
  idFieldsTable.innerHTML = '';
  idFileInput.value = '';
  idPreviewImg.src = '';
}

idScanBtn.addEventListener('click', openIdModal);
idModalClose.addEventListener('click', closeIdModal);
idModal.addEventListener('click', (e) => { if (e.target === idModal) closeIdModal(); });

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchIdTab(tab) {
  const isUpload = tab === 'upload';
  tabUpload.classList.toggle('active', isUpload);
  tabCamera.classList.toggle('active', !isUpload);
  panelUpload.classList.toggle('id-panel--hidden', !isUpload);
  panelCamera.classList.toggle('id-panel--hidden', isUpload);
  if (!isUpload) startCamera(); else stopCamera();
}

tabUpload.addEventListener('click', () => switchIdTab('upload'));
tabCamera.addEventListener('click', () => switchIdTab('camera'));

// ── Camera ────────────────────────────────────────────────────────────────────

async function startCamera() {
  if (cameraStream) return;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }, audio: false,
    });
    idVideo.srcObject = cameraStream;
  } catch (e) {
    setIdStatus('Camera not available: ' + e.message, 'error');
  }
}

function stopCamera() {
  if (!cameraStream) return;
  cameraStream.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  if (idVideo) idVideo.srcObject = null;
}

idCaptureBtn.addEventListener('click', () => {
  if (!cameraStream) return;
  const ctx = idCanvas.getContext('2d');
  idCanvas.width  = idVideo.videoWidth  || 640;
  idCanvas.height = idVideo.videoHeight || 480;
  ctx.drawImage(idVideo, 0, 0);
  idCanvas.toBlob((blob) => {
    if (blob) setIdImage(blob, 'image/jpeg');
  }, 'image/jpeg', 0.92);
});

// ── File upload ───────────────────────────────────────────────────────────────

idDropZone.addEventListener('click', () => idFileInput.click());
idDropZone.addEventListener('dragover', (e) => {
  e.preventDefault(); idDropZone.classList.add('drag-over');
});
idDropZone.addEventListener('dragleave', () => idDropZone.classList.remove('drag-over'));
idDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  idDropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) setIdImage(file, file.type);
});
idFileInput.addEventListener('change', () => {
  const file = idFileInput.files[0];
  if (file) setIdImage(file, file.type);
});

// ── Image selection ───────────────────────────────────────────────────────────

function setIdImage(blob, mimeType) {
  idImageBlob = { blob, mimeType };
  const url = URL.createObjectURL(blob);
  idPreviewImg.src = url;
  idPreviewWrap.classList.remove('id-preview-wrap--hidden');
  idResults.classList.add('id-results--hidden');
  idConfirmBtn.classList.add('id-confirm-btn--hidden');
  idSubmitBtn.disabled = false;
  idSubmitBtn.textContent = '🔍 Extract Info';
  setIdStatus('Image selected — click "Extract Info" to scan.', '');
}

idRetakeBtn.addEventListener('click', resetIdModal);

// ── Submit to /api/passport ───────────────────────────────────────────────────

idSubmitBtn.addEventListener('click', async () => {
  if (!idImageBlob || !sessionId) return;

  idSubmitBtn.disabled = true;
  idSubmitBtn.textContent = '⏳ Scanning…';
  setIdStatus('Processing document…', '');
  idResults.classList.add('id-results--hidden');
  idConfirmBtn.classList.add('id-confirm-btn--hidden');

  const ext = idImageBlob.mimeType.includes('png')  ? 'png'
            : idImageBlob.mimeType.includes('webp') ? 'webp'
            : 'jpg';
  const form = new FormData();
  form.append('image', idImageBlob.blob, `document.${ext}`);

  try {
    const res  = await apiFetch(
      `/api/passport?sessionId=${encodeURIComponent(sessionId)}`,
      { method: 'POST', body: form },
    );
    const data = await res.json();

    if (data.ok) {
      const conf   = Math.round((data.confidences?.overall ?? 0) * 100);
      const mrzTag = data.validation?.mrzFound
        ? (data.validation.mrzChecksumPassed ? '✓ MRZ valid' : '⚠ MRZ checksum failed')
        : '(no MRZ — heuristic only)';
      setIdStatus(`Extracted · ${mrzTag} · ${conf}% confidence`, 'ok');
      showIdFields(data.maskedFields);
      idConfirmBtn.classList.remove('id-confirm-btn--hidden');
      idSubmitBtn.textContent = '🔄 Re-scan';
      idSubmitBtn.disabled = false;
    } else {
      const errs = (data.errors || []).join(', ') || 'Unknown error';
      setIdStatus(`Extraction failed: ${errs}`, 'error');
      idSubmitBtn.textContent = '🔍 Extract Info';
      idSubmitBtn.disabled = false;
    }
  } catch (e) {
    setIdStatus(`Error: ${e.message}`, 'error');
    idSubmitBtn.textContent = '🔍 Extract Info';
    idSubmitBtn.disabled = false;
  }
});

// ── Confirm ───────────────────────────────────────────────────────────────────

idConfirmBtn.addEventListener('click', async () => {
  if (!sessionId) return;
  idConfirmBtn.disabled = true;
  setIdStatus('Confirming…', '');

  try {
    await apiFetch('/api/passport/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });

    setIdStatus('✓ Identity confirmed!', 'ok');
    idScanBtn.classList.add('scanned');
    idScanBtn.textContent = '✓ ID Scanned';

    // Close modal after short delay and trigger an agent turn
    setTimeout(() => {
      closeIdModal();
      textInput.value = 'I have scanned and confirmed my identity document.';
      sendText();
    }, 1200);
  } catch (e) {
    setIdStatus(`Confirm failed: ${e.message}`, 'error');
    idConfirmBtn.disabled = false;
  }
});

// ── Field table ───────────────────────────────────────────────────────────────

function showIdFields(fields) {
  if (!fields) return;
  idFieldsTable.innerHTML = '';
  const rows = [
    ['Full Name',       fields.fullName],
    ['Document Type',   fields.documentType],
    ['Document No.',    fields.documentNumber],
    ['Date of Birth',   fields.dateOfBirth],
    ['Expiry Date',     fields.expiryDate],
    ['Nationality',     fields.nationality],
    ['Issuing Country', fields.issuingCountry],
    ['Sex',             fields.sex],
  ];
  let hasAny = false;
  for (const [label, value] of rows) {
    if (!value) continue;
    hasAny = true;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${label}</td><td>${value}</td>`;
    idFieldsTable.appendChild(tr);
  }
  if (hasAny) {
    idResults.classList.remove('id-results--hidden');
  } else {
    setIdStatus('No fields could be extracted from this document.', 'error');
  }
}

function setIdStatus(message, type) {
  idStatus.textContent = message;
  idStatus.className = 'id-status' + (type ? ` ${type}` : '');
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function timeStr() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Boot ───────────────────────────────────────────────────────────────────────

initTrace();   // restore collapsed/expanded state from localStorage before first paint
init();        // create/restore session (async)
