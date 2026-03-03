"use strict";
/**
 * llama.cpp HTTP server adapter.
 * Compatible with the OpenAI-compatible API exposed by llama.cpp server:
 *   ./llama-server -m model.gguf --port 8080
 *
 * Env vars: LLAMACPP_ENDPOINT (default: http://localhost:8080)
 *           LLAMACPP_MODEL    (default: local)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlamaCppAdapter = void 0;
class LlamaCppAdapter {
    endpoint;
    model;
    constructor() {
        this.endpoint = (process.env.LLAMACPP_ENDPOINT ?? 'http://localhost:8080').replace(/\/$/, '');
        this.model = process.env.LLAMACPP_MODEL ?? 'local';
    }
    async chat(messages, options) {
        const url = `${this.endpoint}/v1/chat/completions`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                messages,
                temperature: options?.temperature ?? 0.1,
                max_tokens: options?.maxTokens ?? 1200,
                stream: false,
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`llama.cpp HTTP error ${res.status}: ${body}`);
        }
        const data = (await res.json());
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('llama.cpp returned an empty response.');
        }
        return content;
    }
}
exports.LlamaCppAdapter = LlamaCppAdapter;
//# sourceMappingURL=llamacpp.js.map