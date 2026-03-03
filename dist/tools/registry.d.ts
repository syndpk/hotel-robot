/**
 * Tool registry — central catalogue of all tools available to the agent.
 *
 * Each entry defines:
 *  - name        : string key used in CALL_TOOL actions
 *  - description : shown verbatim in the LLM system prompt
 *  - schema      : Zod schema used to validate agent-supplied args
 *  - execute     : async function that runs the tool
 *
 * Adding a new tool: add one entry here and implement the handler module.
 */
import { z } from 'zod';
export interface ToolDefinition {
    name: string;
    description: string;
    schema: z.ZodObject<any>;
    execute: (args: Record<string, unknown>) => Promise<unknown>;
}
export declare const TOOLS: ToolDefinition[];
export declare function getTool(name: string): ToolDefinition | undefined;
/**
 * Execute a tool by name with raw (unvalidated) args.
 * Throws ZodError if args are invalid — caller should catch and record as VALIDATION_ERROR.
 */
export declare function executeTool(name: string, args: Record<string, unknown>): Promise<unknown>;
/**
 * Build a compact tool schema description for injection into the system prompt.
 */
export declare function buildToolSchemasText(): string;
