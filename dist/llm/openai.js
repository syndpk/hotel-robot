"use strict";
/**
 * OpenAI adapter.
 * Env vars: OPENAI_API_KEY, OPENAI_MODEL (default: gpt-4o-mini)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIAdapter = void 0;
const openai_1 = __importDefault(require("openai"));
class OpenAIAdapter {
    client;
    model;
    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY is not set. ' +
                'Add it to your .env file, or switch to llama.cpp by setting LLM_BACKEND=llamacpp.');
        }
        this.client = new openai_1.default({ apiKey });
        this.model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    }
    async chat(messages, options) {
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: messages,
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
exports.OpenAIAdapter = OpenAIAdapter;
//# sourceMappingURL=openai.js.map