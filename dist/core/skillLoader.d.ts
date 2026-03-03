/**
 * Skill loader — reads SOP packs from src/skills/*.skill.md and selects
 * the most relevant ones for each user query using keyword matching.
 *
 * Adding a new skill: drop a *.skill.md file in src/skills/ — no code changes needed.
 */
import { SkillDoc } from './types';
/**
 * Return the top-k most relevant skills for a given user query.
 * Always includes at least 1 skill (highest scoring), even if score is 0.
 */
export declare function selectSkills(query: string, topK?: number): SkillDoc[];
/**
 * Load all skills (for system prompts that need full coverage).
 */
export declare function loadAllSkills(): SkillDoc[];
