/**
 * OpenAI adapter.
 * Env vars: OPENAI_API_KEY, OPENAI_MODEL (default: gpt-4o-mini)
 */

import OpenAI from 'openai';
import { LLMClient, ChatMessage, ChatOptions } from './llm';

export class OpenAIAdapter implements LLMClient {
  private client: OpenAI;
  private model: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is not set. ' +
        'Add it to your .env file, or switch to llama.cpp by setting LLM_BACKEND=llamacpp.',
      );
    }
    this.client = new OpenAI({ apiKey });
    this.model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens ?? 1200,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned an empty response.');
    }
    return content;
  }
}
