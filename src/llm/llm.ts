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

// ── Factory ────────────────────────────────────────────────────────────────────

let _client: LLMClient | null = null;

/**
 * Read and normalise the LLM_BACKEND env var.
 * Trims whitespace and lowercases so values like "LlamaCpp", "llamacpp\r"
 * (Windows CRLF in .env files) all resolve correctly.
 */
export function resolvedBackend(): string {
  return (process.env.LLM_BACKEND ?? 'openai').trim().toLowerCase();
}

export function getLLMClient(): LLMClient {
  if (_client) return _client;

  const backend = resolvedBackend();

  if (backend === 'llamacpp') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LlamaCppAdapter } = require('./llamacpp') as typeof import('./llamacpp');
    _client = new LlamaCppAdapter();
  } else if (backend === 'openai') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OpenAIAdapter } = require('./openai') as typeof import('./openai');
    _client = new OpenAIAdapter();
  } else {
    throw new Error(
      `Unknown LLM_BACKEND value: "${backend}". ` +
      `Valid values are "openai" or "llamacpp". Check your .env file.`,
    );
  }

  return _client;
}
