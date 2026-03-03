/**
 * Skill loader — reads SOP packs from src/skills/*.skill.md and selects
 * the most relevant ones for each user query using keyword matching.
 *
 * Adding a new skill: drop a *.skill.md file in src/skills/ — no code changes needed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SkillDoc } from './types';

const SKILLS_DIR = path.resolve(__dirname, '..', 'skills');

// ── Skill metadata ─────────────────────────────────────────────────────────────

interface SkillMeta {
  name: string;
  filePath: string;
  keywords: string[];
  content: string;
}

// Extract keywords from the "When to use" section of a skill file.
function extractKeywords(content: string): string[] {
  const match = content.match(/## When to use\s*\n([^\n#]+)/i);
  if (!match) return [];
  return match[1]
    .toLowerCase()
    .replace(/[^a-z0-9,\s]/g, ' ')
    .split(/[\s,]+/)
    .filter((k) => k.length > 3);
}

function loadSkills(): SkillMeta[] {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.warn('[skillLoader] skills directory not found at', SKILLS_DIR);
    return [];
  }

  const files = fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.skill.md'));

  return files.map((file) => {
    const filePath = path.join(SKILLS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    // Name = first H1 heading
    const nameMatch = content.match(/^#\s+(.+)$/m);
    const name = nameMatch ? nameMatch[1].trim() : path.basename(file, '.skill.md');
    return { name, filePath, keywords: extractKeywords(content), content };
  });
}

// Cache skills to avoid repeated disk reads
let _skills: SkillMeta[] | null = null;

function getSkills(): SkillMeta[] {
  if (!_skills) _skills = loadSkills();
  return _skills;
}

// ── Selector ───────────────────────────────────────────────────────────────────

/**
 * Score a skill against the user query.
 * Returns number of keyword matches (higher = more relevant).
 */
function scoreSkill(skill: SkillMeta, queryTokens: string[]): number {
  let score = 0;
  for (const qt of queryTokens) {
    for (const kw of skill.keywords) {
      if (kw === qt) score += 2;
      else if (kw.startsWith(qt) || qt.startsWith(kw)) score += 1;
    }
  }
  return score;
}

/**
 * Return the top-k most relevant skills for a given user query.
 * Always includes at least 1 skill (highest scoring), even if score is 0.
 */
export function selectSkills(query: string, topK = 2): SkillDoc[] {
  const skills = getSkills();
  if (skills.length === 0) return [];

  const queryTokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const scored = skills
    .map((s) => ({ skill: s, score: scoreSkill(s, queryTokens) }))
    .sort((a, b) => b.score - a.score);

  // Always return at least 1 skill
  const selected = scored.slice(0, Math.max(1, topK)).filter((s, i) => i === 0 || s.score > 0);

  return selected.map(({ skill }) => ({
    name: skill.name,
    content: skill.content,
  }));
}

/**
 * Load all skills (for system prompts that need full coverage).
 */
export function loadAllSkills(): SkillDoc[] {
  return getSkills().map((s) => ({ name: s.name, content: s.content }));
}
