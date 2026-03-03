"use strict";
/**
 * Skill loader — reads SOP packs from src/skills/*.skill.md and selects
 * the most relevant ones for each user query using keyword matching.
 *
 * Adding a new skill: drop a *.skill.md file in src/skills/ — no code changes needed.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectSkills = selectSkills;
exports.loadAllSkills = loadAllSkills;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const SKILLS_DIR = path.resolve(__dirname, '..', 'skills');
// Extract keywords from the "When to use" section of a skill file.
function extractKeywords(content) {
    const match = content.match(/## When to use\s*\n([^\n#]+)/i);
    if (!match)
        return [];
    return match[1]
        .toLowerCase()
        .replace(/[^a-z0-9,\s]/g, ' ')
        .split(/[\s,]+/)
        .filter((k) => k.length > 3);
}
function loadSkills() {
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
let _skills = null;
function getSkills() {
    if (!_skills)
        _skills = loadSkills();
    return _skills;
}
// ── Selector ───────────────────────────────────────────────────────────────────
/**
 * Score a skill against the user query.
 * Returns number of keyword matches (higher = more relevant).
 */
function scoreSkill(skill, queryTokens) {
    let score = 0;
    for (const qt of queryTokens) {
        for (const kw of skill.keywords) {
            if (kw === qt)
                score += 2;
            else if (kw.startsWith(qt) || qt.startsWith(kw))
                score += 1;
        }
    }
    return score;
}
/**
 * Return the top-k most relevant skills for a given user query.
 * Always includes at least 1 skill (highest scoring), even if score is 0.
 */
function selectSkills(query, topK = 2) {
    const skills = getSkills();
    if (skills.length === 0)
        return [];
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
function loadAllSkills() {
    return getSkills().map((s) => ({ name: s.name, content: s.content }));
}
//# sourceMappingURL=skillLoader.js.map