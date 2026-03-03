"use strict";
/**
 * ElevenLabs voice client.
 *
 * STT: POST /v1/speech-to-text   — audio buffer → transcript text
 * TTS: POST /v1/text-to-speech/{voice_id} — text → MP3 buffer → base64
 *
 * Env vars:
 *   ELEVENLABS_API_KEY
 *   ELEVENLABS_VOICE_ID  (default: Rachel — 21m00Tcm4TlvDq8ikWAM)
 *   ELEVENLABS_STT_MODEL (default: scribe_v1)
 *   ELEVENLABS_TTS_MODEL (default: eleven_flash_v2_5)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcribeAudio = transcribeAudio;
exports.synthesiseSpeech = synthesiseSpeech;
exports.synthesiseSpeechBase64 = synthesiseSpeechBase64;
exports.checkElevenLabs = checkElevenLabs;
const API_BASE = 'https://api.elevenlabs.io/v1';
function getKey() {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key)
        throw new Error('ELEVENLABS_API_KEY is not set.');
    return key;
}
/**
 * Transcribe audio using ElevenLabs Scribe STT.
 *
 * @param audioBuffer  - Raw audio bytes (webm, mp3, wav, ogg, etc.)
 * @param mimeType     - MIME type, e.g. 'audio/webm' or 'audio/mpeg'
 * @param languageCode - BCP-47 hint sent to Scribe (e.g. 'en', 'el', 'es').
 *                       Falls back to STT_LANGUAGE env var, then 'en'.
 *                       Supplying the correct language dramatically reduces
 *                       misdetection (e.g. English → Spanish).
 */
async function transcribeAudio(audioBuffer, mimeType = 'audio/webm', languageCode) {
    const key = getKey();
    const model = process.env.ELEVENLABS_STT_MODEL ?? 'scribe_v1';
    const lang = languageCode ?? process.env.STT_LANGUAGE ?? 'en';
    // Build multipart form data using native FormData (Node 18+)
    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType });
    form.append('file', blob, 'audio.webm');
    form.append('model_id', model);
    form.append('language_code', lang); // explicit hint prevents mis-detection
    console.log(`[elevenlabs] STT request — model=${model} lang_hint=${lang} bytes=${audioBuffer.length}`);
    const res = await fetch(`${API_BASE}/speech-to-text`, {
        method: 'POST',
        headers: { 'xi-api-key': key },
        body: form,
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        // Log status + body but no key
        console.error(`[elevenlabs] STT error — status=${res.status} body=${body.slice(0, 200)}`);
        throw new Error(`ElevenLabs STT error ${res.status}: ${body}`);
    }
    const data = (await res.json());
    const detected = data.language_code ?? lang;
    if (data.language_code && data.language_code !== lang) {
        // Warn when detected language differs from the hint — helps diagnose issues
        console.warn(`[elevenlabs] STT detected "${data.language_code}" but hint was "${lang}". ` +
            `Check the UI language selector or STT_LANGUAGE env var.`);
    }
    else {
        console.log(`[elevenlabs] STT OK — detected_lang=${detected} chars=${(data.text ?? '').length}`);
    }
    return {
        transcript: data.text ?? '',
        languageCode: detected,
    };
}
// ── TTS ────────────────────────────────────────────────────────────────────────
/**
 * Synthesise speech using ElevenLabs TTS.
 * Returns raw MP3 bytes as a Buffer.
 */
async function synthesiseSpeech(text) {
    const key = getKey();
    const voiceId = process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';
    const model = process.env.ELEVENLABS_TTS_MODEL ?? 'eleven_flash_v2_5';
    const res = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
            'xi-api-key': key,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
            text,
            model_id: model,
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0.1,
                use_speaker_boost: true,
            },
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`ElevenLabs TTS error ${res.status}: ${body}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
/**
 * Convenience: synthesise and return base-64 encoded MP3 string.
 */
async function synthesiseSpeechBase64(text) {
    const buf = await synthesiseSpeech(text);
    return buf.toString('base64');
}
/**
 * Lightweight connectivity check: GET /v1/user.
 * Used by the /api/health endpoint to verify the API key is valid.
 * Returns { ok: false } without throwing if the key is missing or rejected.
 */
async function checkElevenLabs() {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key)
        return { ok: false, detail: 'ELEVENLABS_API_KEY is not set' };
    try {
        const res = await fetch(`${API_BASE}/user`, {
            headers: { 'xi-api-key': key },
        });
        if (res.ok)
            return { ok: true, detail: 'connected' };
        // 401 = bad key, 429 = quota exceeded, etc.
        return { ok: false, detail: `HTTP ${res.status}` };
    }
    catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : 'network error' };
    }
}
//# sourceMappingURL=elevenlabs.js.map