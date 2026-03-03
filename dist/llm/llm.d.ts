/**
 * LLM abstraction layer.
 * Any backend must implement LLMClient.
 * Select backend via LLM_BACKEND env var: "openai" | "llamacpp"
 */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface ChatOptions {
    temperature?: number;
    maxTokens?: number;
}
export interface LLMClient {
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}
/**
 * Read and normalise the LLM_BACKEND env var.
 * Trims whitespace and lowercases so values like "LlamaCpp", "llamacpp\r"
 * (Windows CRLF in .env files) all resolve correctly.
 */
export declare function resolvedBackend(): string;
export declare function getLLMClient(): LLMClient;
