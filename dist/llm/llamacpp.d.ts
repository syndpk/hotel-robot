/**
 * llama.cpp HTTP server adapter.
 * Compatible with the OpenAI-compatible API exposed by llama.cpp server:
 *   ./llama-server -m model.gguf --port 8080
 *
 * Env vars: LLAMACPP_ENDPOINT (default: http://localhost:8080)
 *           LLAMACPP_MODEL    (default: local)
 */
import { LLMClient, ChatMessage, ChatOptions } from './llm';
export declare class LlamaCppAdapter implements LLMClient {
    private endpoint;
    private model;
    constructor();
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}
