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
export interface STTResult {
    transcript: string;
    languageCode?: string;
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
export declare function transcribeAudio(audioBuffer: Buffer, mimeType?: string, languageCode?: string): Promise<STTResult>;
/**
 * Synthesise speech using ElevenLabs TTS.
 * Returns raw MP3 bytes as a Buffer.
 */
export declare function synthesiseSpeech(text: string): Promise<Buffer>;
/**
 * Convenience: synthesise and return base-64 encoded MP3 string.
 */
export declare function synthesiseSpeechBase64(text: string): Promise<string>;
export interface ElevenLabsHealthResult {
    ok: boolean;
    detail: string;
}
/**
 * Lightweight connectivity check: GET /v1/user.
 * Used by the /api/health endpoint to verify the API key is valid.
 * Returns { ok: false } without throwing if the key is missing or rejected.
 */
export declare function checkElevenLabs(): Promise<ElevenLabsHealthResult>;
