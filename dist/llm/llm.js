"use strict";
/**
 * LLM abstraction layer.
 * Any backend must implement LLMClient.
 * Select backend via LLM_BACKEND env var: "openai" | "llamacpp"
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvedBackend = resolvedBackend;
exports.getLLMClient = getLLMClient;
// ── Factory ────────────────────────────────────────────────────────────────────
let _client = null;
/**
 * Read and normalise the LLM_BACKEND env var.
 * Trims whitespace and lowercases so values like "LlamaCpp", "llamacpp\r"
 * (Windows CRLF in .env files) all resolve correctly.
 */
function resolvedBackend() {
    return (process.env.LLM_BACKEND ?? 'openai').trim().toLowerCase();
}
function getLLMClient() {
    if (_client)
        return _client;
    const backend = resolvedBackend();
    if (backend === 'llamacpp') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { LlamaCppAdapter } = require('./llamacpp');
        _client = new LlamaCppAdapter();
    }
    else if (backend === 'openai') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { OpenAIAdapter } = require('./openai');
        _client = new OpenAIAdapter();
    }
    else {
        throw new Error(`Unknown LLM_BACKEND value: "${backend}". ` +
            `Valid values are "openai" or "llamacpp". Check your .env file.`);
    }
    return _client;
}
//# sourceMappingURL=llm.js.map