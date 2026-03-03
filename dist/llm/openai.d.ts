/**
 * OpenAI adapter.
 * Env vars: OPENAI_API_KEY, OPENAI_MODEL (default: gpt-4o-mini)
 */
import { LLMClient, ChatMessage, ChatOptions } from './llm';
export declare class OpenAIAdapter implements LLMClient {
    private client;
    private model;
    constructor();
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}
