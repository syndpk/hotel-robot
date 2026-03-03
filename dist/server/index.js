"use strict";
/**
 * HTTP server entry point.
 *
 * Runs standalone with:  npm run dev  (dev)  or  npm start  (prod)
 * Docker:  docker build -t hotel-robot . && docker run -p 3000:3000 hotel-robot
 *
 * No external process manager required — just Node.js.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
// ── dotenv — must be the very first imports so every module sees env vars ──────
//
// Pass 1: load from process.cwd() (the project root when you run npm run dev).
// This is the standard path and covers the common case.
require("dotenv/config");
// Pass 2: load from the path relative to __dirname so it works even when the
// server is started from a directory other than the project root.
// override:false means vars already set by pass 1 (or the shell) are kept.
const dotenv_1 = require("dotenv");
const path_1 = __importDefault(require("path"));
const _envFile = path_1.default.resolve(__dirname, '../../.env');
const { error: _dotenvError, parsed: _dotenvParsed } = (0, dotenv_1.config)({ path: _envFile, override: false });
// Print result immediately (Fastify logger not available yet).
if (_dotenvError) {
    console.warn(`[dotenv] .env not found at "${_envFile}".`);
    console.warn('[dotenv] Hint: cp .env.example .env  (Mac/Linux)');
    console.warn('[dotenv] Hint: copy .env.example .env  (Windows CMD)');
    console.warn('[dotenv] Windows users: verify the file is named .env, not .env.txt');
    console.warn('[dotenv] Check with:  dir /A  in the hotel-robot directory');
    console.warn('[dotenv] Falling back to shell/process environment variables.');
}
else {
    const _varNames = _dotenvParsed ? Object.keys(_dotenvParsed) : [];
    console.log(`[dotenv] Loaded ${_varNames.length} var(s) from "${_envFile}": ${_varNames.join(', ')}`);
}
console.log(`[dotenv] LLM_BACKEND="${process.env.LLM_BACKEND ?? '(not set → defaults to openai)'}"` +
    ` | ELEVENLABS_API_KEY=${process.env.ELEVENLABS_API_KEY ? '✓ set' : '✗ not set'}`);
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const static_1 = __importDefault(require("@fastify/static"));
const routes_1 = require("./routes");
const conciergeIndex_1 = require("../core/rag/conciergeIndex");
const skillLoader_1 = require("../core/skillLoader");
const llm_1 = require("../llm/llm");
// ── Build Fastify app ──────────────────────────────────────────────────────────
const app = (0, fastify_1.default)({
    logger: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        // Redact sensitive fields — never log raw audio or API keys
        redact: ['req.headers.authorization', 'req.headers["xi-api-key"]'],
    },
    disableRequestLogging: false,
});
exports.app = app;
async function main() {
    // ── Plugins ────────────────────────────────────────────────────────────────
    await app.register(cors_1.default, {
        origin: true, // allow all origins for local dev; restrict in prod
        methods: ['GET', 'POST', 'OPTIONS'],
    });
    // Multipart for audio upload (max 10 MB)
    await app.register(multipart_1.default, {
        limits: { fileSize: 10 * 1024 * 1024 },
    });
    // Serve UI static files
    await app.register(static_1.default, {
        root: path_1.default.resolve(process.cwd(), 'ui'),
        prefix: '/',
        decorateReply: true,
    });
    // ── Routes ─────────────────────────────────────────────────────────────────
    await (0, routes_1.registerRoutes)(app);
    // ── Log resolved configuration ─────────────────────────────────────────────
    const backend = (0, llm_1.resolvedBackend)();
    app.log.info({
        LLM_BACKEND: backend,
        endpoint: backend === 'llamacpp'
            ? (process.env.LLAMACPP_ENDPOINT ?? 'http://localhost:8080')
            : `openai/${process.env.OPENAI_MODEL ?? 'gpt-4o-mini'}`,
    }, '[startup] LLM backend resolved.');
    // ── Warm up indexes at startup ─────────────────────────────────────────────
    try {
        const index = (0, conciergeIndex_1.getConciergeIndex)();
        const testHits = index.search('hotel', 1);
        app.log.info({ docs: testHits.length }, '[startup] Concierge index loaded.');
    }
    catch (e) {
        app.log.warn('[startup] Concierge index failed to load: ' + e);
    }
    try {
        const skills = (0, skillLoader_1.selectSkills)('check in', 2);
        app.log.info({ skills: skills.map((s) => s.name) }, '[startup] Skill loader ready.');
    }
    catch (e) {
        app.log.warn('[startup] Skill loader failed: ' + e);
    }
    // ── Voice dependency check ─────────────────────────────────────────────────
    if (!process.env.ELEVENLABS_API_KEY) {
        app.log.warn('[startup] ELEVENLABS_API_KEY is not set — voice features (STT/TTS) are disabled. ' +
            'Text mode still works. Add the key to .env to enable push-to-talk.');
    }
    else {
        app.log.info('[startup] ElevenLabs API key detected — voice features enabled.');
    }
    // ── Listen ─────────────────────────────────────────────────────────────────
    const port = parseInt(process.env.PORT ?? '3000', 10);
    const host = process.env.HOST ?? '0.0.0.0';
    await app.listen({ port, host });
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🏨  Hotel Receptionist Voice Agent');
    console.log(`  UI  →  http://localhost:${port}/`);
    console.log(`  API →  http://localhost:${port}/api`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}
main().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map