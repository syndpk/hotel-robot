"use strict";
/**
 * Ingestion script — optional pre-processing step.
 *
 * For the keyword-based index (v0): simply validates that all documents
 * load correctly and prints a summary.
 *
 * For a future embeddings-based index: this is where you would:
 *   1. Chunk each markdown document into passages.
 *   2. Call an embeddings API (e.g. OpenAI text-embedding-3-small).
 *   3. Persist the vectors to a file (JSON or sqlite-vec) for fast lookup.
 *
 * Run:  npm run ingest
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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const DOCS_DIR = path.resolve(__dirname, '..', '..', 'concierge_docs');
async function ingest() {
    console.log('─────────────────────────────────────');
    console.log('Hotel-Robot Concierge Index Ingestion');
    console.log('─────────────────────────────────────');
    console.log(`Docs directory: ${DOCS_DIR}\n`);
    if (!fs.existsSync(DOCS_DIR)) {
        console.error('ERROR: concierge_docs directory not found!');
        process.exit(1);
    }
    const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'));
    if (files.length === 0) {
        console.warn('WARNING: No .md files found in concierge_docs.');
        process.exit(0);
    }
    const summaries = [];
    for (const file of files) {
        const fullPath = path.join(DOCS_DIR, file);
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const idMatch = raw.match(/^id:\s*(.+)$/m);
        const titleMatch = raw.match(/^title:\s*(.+)$/m);
        const id = idMatch ? idMatch[1].trim() : path.basename(file, '.md');
        const title = titleMatch ? titleMatch[1].trim() : id;
        const paragraphs = raw
            .split(/\n{2,}/)
            .map((s) => s.trim())
            .filter((s) => s.length > 40 && !s.startsWith('---')).length;
        summaries.push({ file, id, title, paragraphs, chars: raw.length });
    }
    console.log('Indexed documents:');
    for (const s of summaries) {
        console.log(`  ✓ [${s.id}] "${s.title}" — ${s.paragraphs} paragraphs, ${s.chars} chars`);
    }
    console.log(`\nTotal: ${summaries.length} document(s) ready for keyword search.`);
    console.log('\n── Future embeddings upgrade ──────────────────────────────');
    console.log('To switch to embeddings-based retrieval:');
    console.log('  1. Install: npm install @xenova/transformers  (local)');
    console.log('     OR use: openai.embeddings.create(...)');
    console.log('  2. Chunk each document (e.g. 200-token windows with overlap).');
    console.log('  3. Compute embedding vectors and save to concierge_index.json.');
    console.log('  4. Update conciergeIndex.ts to load vectors and use cosine sim.');
    console.log('───────────────────────────────────────────────────────────\n');
    console.log('Ingestion complete.');
}
ingest().catch((err) => {
    console.error('Ingestion failed:', err);
    process.exit(1);
});
//# sourceMappingURL=ingest.js.map