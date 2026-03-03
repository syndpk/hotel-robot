# 🏨 Hotel Receptionist Voice Agent

A **production-grade, host-agnostic** voice + text agent system for hotel receptionists, built with a custom orchestration platform. No Trigger.dev, no managed platforms — runs on your own servers via a single Docker command.

---

## Architecture Overview

```
Browser (UI)
  │  push-to-talk audio / text
  ▼
Fastify HTTP Server (src/server/)
  │  POST /api/audio  → ElevenLabs STT → transcript
  │  POST /api/message → text input
  │  GET  /api/runs/:id/events → SSE stream
  ▼
Orchestrator (src/core/orchestrator.ts)
  │  A) assembles context: hotel config + relevant skills.md + concierge RAG
  │  B) runs agent loop (max 6 steps)
  │  C) applies policy gates (confirmations, escalation rules)
  │  D) streams trace steps via EventEmitter → SSE
  ▼
Agent Loop (src/core/agentLoop.ts)
  │  → LLM (OpenAI / llama.cpp) outputs NextAction JSON
  │  → validates with Zod
  │  → executes tools (taxiSim, pmsSim, conciergeSearch)
  │  → feeds results back to LLM
  ▼
ElevenLabs TTS → MP3 base64 → Browser audio player
```

### NextAction Schema (LLM output contract)

Every LLM step outputs **exactly one** of:

```json
{"action": "ASK_USER",  "question": "..."}
{"action": "CALL_TOOL", "tool": "...", "args": {...}}
{"action": "RESPOND",   "message": "..."}
{"action": "HANDOFF",   "reason": "..."}
```

---

## Quick Start (Local)

### Prerequisites
- **Node.js 20+**
- **npm 9+**
- ElevenLabs API key (for voice; text-only works without it)
- OpenAI API key **OR** a running llama.cpp server

### 1. Install dependencies

```bash
cd hotel-robot
npm install
```

### 2. Configure environment

**Mac / Linux:**
```bash
cp .env.example .env
```

**Windows (Command Prompt):**
```cmd
copy .env.example .env
```

**Windows (PowerShell):**
```powershell
Copy-Item .env.example .env
```

> **Windows gotcha — hidden `.txt` extension**
> Windows Explorer hides known extensions by default. If you rename or save the file in
> Notepad, it may silently become `.env.txt` instead of `.env`.  Verify with:
> ```cmd
> dir /A
> ```
> You should see `.env` in the list.  If you see `.env.txt`, rename it:
> ```cmd
> ren .env.txt .env
> ```

Edit `.env` and fill in your API keys.

Minimum required for text mode:
```env
LLM_BACKEND=openai
OPENAI_API_KEY=sk-...
```

Add these for voice:
```env
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

### 3. (Optional) Run ingestion check

```bash
npm run ingest
```

Validates all concierge docs load correctly and prints a summary.

### 4. Start the server

```bash
# Development (auto-restart on changes)
npm run dev

# Production build + start
npm run build && npm start
```

The Fastify server listens on **:3000** by default and serves the `ui/` folder as static files.

### 5. Open the UI

#### Option A — Recommended: served by the backend (zero config)

```
http://localhost:3000/
```

The backend serves `ui/index.html` directly. API calls go to the same origin — no CORS issues,
no extra configuration needed.

#### Option B — Separate static server (e.g. Vite, live-server, VS Code Live Preview)

When your static server runs on a **different port** (e.g. `:5173`), `app.js` auto-detects
this and points all API calls at `http://localhost:3000`.

```
http://localhost:5173/          ← auto-detects backend at http://localhost:3000
```

If the backend is on a non-default port or host, pass `?apiBase=` explicitly:

```
http://localhost:5173/?apiBase=http://localhost:4000
```

The value is persisted in `sessionStorage` for the rest of the browser session, so you only
need to add it once. The resolved base URL is shown in the header (`API: ...`).

---

## Switching LLM Backend

### OpenAI (default)

```env
LLM_BACKEND=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini   # or gpt-4o, gpt-3.5-turbo, etc.
```

### llama.cpp (local, no API key needed)

1. Download llama.cpp and a GGUF model (e.g. Mistral, Llama-3, Qwen):
   ```bash
   # Run the server (OpenAI-compatible API)
   ./llama-server -m models/mistral-7b-instruct.Q4_K_M.gguf --port 8080 --ctx-size 4096
   ```

2. Update `.env`:
   ```env
   LLM_BACKEND=llamacpp
   LLAMACPP_ENDPOINT=http://localhost:8080
   LLAMACPP_MODEL=local
   ```

3. Restart the hotel-robot server. **No other code changes needed.**

> **Note:** The prompt format is the same for both backends — the agent loop outputs pure JSON and the system prompt works with any instruction-following model. Larger/better models will follow the JSON schema more reliably.

---

## Adding Skills (SOP Packs)

Skills are Markdown files in `src/skills/`. The skill loader automatically picks them up — **no code changes required**.

### Create a new skill

```bash
touch src/skills/spa.skill.md
```

```markdown
# Skill: Spa & Wellness

## When to use
Use this skill when the guest mentions: spa, massage, sauna, wellness, treatment, pool, relax.

## Spa Booking SOP

### Required slots
- `treatmentType` — type of treatment desired
- `preferredTime` — date and time preference

### Step sequence
1. Ask what type of treatment the guest is interested in.
2. Check availability (call `search_concierge` with "spa treatments").
3. Provide options and ask for preferred time.
4. Direct guest to the Spa reception on Level 2 or call ext. 250.
```

The skill loader scores skills based on the "When to use" section keywords and injects the top 2 most relevant skills into every agent prompt.

---

## Adding Concierge Docs

Drop new Markdown files in `src/concierge_docs/`:

```markdown
---
id: island-day-trip
title: Day Trip to the Greek Islands
tags: [islands, ferry, day trip, Aegina, Hydra]
---

# Day Trip to the Greek Islands from Athens

Take the ferry from Piraeus port (25 min by taxi from hotel)...
```

Run `npm run ingest` to verify the doc loads. The keyword index updates automatically on server restart.

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/session` | Create a new conversation session |
| `POST` | `/api/message` | Send text message; returns `{ runId }` |
| `POST` | `/api/audio?sessionId=X` | Upload audio blob; STT → agent → TTS; returns `{ runId, transcript }` |
| `GET`  | `/api/runs/:runId` | Poll run status + output |
| `GET`  | `/api/runs/:runId/events` | **SSE stream** of trace steps |
| `GET`  | `/api/runs/:runId/audio` | Download MP3 TTS audio |
| `GET`  | `/health` | Lightweight server liveness probe |
| `GET`  | `/api/health` | Detailed health — validates ElevenLabs API key via `GET /v1/user` |

`/api/health` response:

```json
{
  "status": "ok",
  "time": "2024-01-01T12:00:00.000Z",
  "llm_backend": "llamacpp",
  "llamacpp_endpoint": "http://localhost:8080",
  "services": {
    "elevenlabs": { "ok": true, "detail": "connected" }
  }
}
```

`llamacpp_endpoint` is only included when `LLM_BACKEND=llamacpp`.
Returns `200 ok` when all services are reachable, `503 degraded` otherwise.

### Example: text message flow

```bash
# 1. Create session
SESSION=$(curl -s -X POST http://localhost:3000/api/session | jq -r .sessionId)

# 2. Send message
RUN=$(curl -s -X POST http://localhost:3000/api/message \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"text\":\"I need a taxi to the airport at 14:00\"}" \
  | jq -r .runId)

# 3. Stream events
curl -N http://localhost:3000/api/runs/$RUN/events
```

---

## Troubleshooting

### Environment variables not loading (`LLM_BACKEND` / `LLAMACPP_ENDPOINT` undefined)

**Symptom:** Server starts but behaves as if `.env` doesn't exist — defaults to OpenAI
even with `LLM_BACKEND=llamacpp`, or throws `OPENAI_API_KEY is not set`.

**Step 1 — Check the startup output.** The server prints dotenv diagnostics before the
Fastify logger starts:

```
[dotenv] Loaded 9 var(s) from "C:\...\hotel-robot\.env": LLM_BACKEND, OPENAI_API_KEY, ...
[dotenv] LLM_BACKEND="llamacpp" | ELEVENLABS_API_KEY=✓ set
```

If you see `[dotenv] .env not found`, the file is missing or misnamed.

**Step 2 — Verify the file exists and is named correctly.**

```cmd
# Windows CMD (run from the hotel-robot directory)
dir /A
```

Look for `.env` in the listing.  If you see `.env.txt` instead:
```cmd
ren .env.txt .env
```

**Step 3 — Confirm env vars are loaded** via the diagnostic endpoint:

```bash
curl http://localhost:3000/api/health
```

Response includes `llm_backend` and `llamacpp_endpoint`:

```json
{
  "status": "ok",
  "llm_backend": "llamacpp",
  "llamacpp_endpoint": "http://localhost:8080",
  "services": { "elevenlabs": { "ok": true, "detail": "connected" } }
}
```

---

### SSE events blocked by CORS (EventSource from a different port)

**Symptom:** Browser console shows `No 'Access-Control-Allow-Origin' header` on
`/api/runs/:runId/events`.

**Cause:** The SSE route uses `reply.hijack()` to write directly to the raw Node.js
socket, which bypasses Fastify's plugin lifecycle — so `@fastify/cors` headers are
never sent for that route.

**Fix (already applied):** The SSE route manually sets `Access-Control-Allow-Origin`
to mirror the request `Origin` before calling `writeHead(200)`.  No action needed.

---

### Voice returns "Speech-to-text failed" (502)

**Step 1 — Check the server log.** The error now includes the full ElevenLabs status
and body:

```
[routes] ElevenLabs STT failed  {"detail":"ElevenLabs STT error 401: ..."}
```

**Step 2 — Verify your API key** with the diagnostic endpoint:

```bash
curl http://localhost:3000/api/health
# { "status":"ok", "services":{"elevenlabs":{"ok":true,"detail":"connected"}} }
# or
# { "status":"degraded", "services":{"elevenlabs":{"ok":false,"detail":"HTTP 401"}} }
```

**Step 3 — Check startup log.** If `ELEVENLABS_API_KEY` is missing the server prints:

```
WARN [startup] ELEVENLABS_API_KEY is not set — voice features (STT/TTS) are disabled.
```

**Step 4 — Common causes:**

| Error | Cause | Fix |
|-------|-------|-----|
| `HTTP 401` | Wrong or expired API key | Update `ELEVENLABS_API_KEY` in `.env` |
| `ELEVENLABS_API_KEY is not set` | Key missing from `.env` | Add `ELEVENLABS_API_KEY=...` to `.env` |
| `HTTP 422` | Audio format rejected | Try a different browser (Chrome works best with WebM/Opus) |
| `network error` | ElevenLabs unreachable | Check internet connection / firewall |

---

## Running Tests

```bash
npm run test:scenarios
```

Runs 10 deterministic scenarios using a mock LLM (no API key needed, fast).

To test against the real LLM:
```bash
USE_REAL_LLM=1 npm run test:scenarios
```

### Test scenarios covered
1. Taxi booking happy path (get quote → confirm → book)
2. Check-in happy path (find reservation → verify ID → check in)
3. Reservation not found → HANDOFF escalation
4. Check-out with confirmation gate
5. Concierge — Athens day itinerary
6. Concierge — rainy day indoor activities
7. Concierge — family with children
8. Taxi with missing destination → ASK_USER for slot
9. Billing dispute → immediate HANDOFF
10. No credit card / sensitive data requested

---

## Docker Deployment

### Build and run

```bash
# From the hotel-robot/ directory
docker build -t hotel-robot -f docker/Dockerfile .

docker run -d \
  --name hotel-robot \
  -p 3000:3000 \
  -e LLM_BACKEND=openai \
  -e OPENAI_API_KEY=sk-... \
  -e ELEVENLABS_API_KEY=... \
  hotel-robot
```

### Docker Compose

```bash
# Copy and fill in .env
cp .env.example .env

# Start
docker compose -f docker/docker-compose.yml up -d

# Logs
docker compose -f docker/docker-compose.yml logs -f

# Stop
docker compose -f docker/docker-compose.yml down
```

### With local llama.cpp

```bash
docker run -d \
  --name hotel-robot \
  -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e LLM_BACKEND=llamacpp \
  -e LLAMACPP_ENDPOINT=http://host.docker.internal:8080 \
  hotel-robot
```

---

## Project Structure

```
hotel-robot/
├── package.json
├── tsconfig.json
├── tsconfig.test.json
├── .env.example
├── README.md
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── src/
│   ├── server/
│   │   ├── index.ts          # HTTP server entry point (Fastify)
│   │   └── routes.ts         # REST + SSE endpoints
│   ├── core/
│   │   ├── orchestrator.ts   # Top-level controller, context assembly
│   │   ├── agentLoop.ts      # Iterative LLM decision loop
│   │   ├── types.ts          # NextAction, TraceStep, Session, Run schemas
│   │   ├── sessionStore.ts   # In-memory store (interface for Redis swap)
│   │   ├── policy.ts         # Confirmation gates, escalation rules
│   │   ├── skillLoader.ts    # Loads & selects skill SOPs from disk
│   │   └── rag/
│   │       ├── conciergeIndex.ts  # Keyword-based retrieval index
│   │       └── ingest.ts         # Doc ingestion / validation script
│   ├── llm/
│   │   ├── llm.ts            # LLMClient interface + factory
│   │   ├── openai.ts         # OpenAI adapter
│   │   └── llamacpp.ts       # llama.cpp HTTP adapter
│   ├── tools/
│   │   ├── registry.ts       # Tool catalogue + dispatcher
│   │   ├── taxiSim.ts        # Taxi quote & booking simulator
│   │   ├── pmsSim.ts         # PMS simulator (5 seeded reservations)
│   │   └── conciergeSearch.ts # Wraps conciergeIndex as a tool
│   ├── voice/
│   │   └── elevenlabs.ts     # STT + TTS client
│   ├── config/
│   │   └── hotel.ts          # Hotel name, address, policies
│   ├── skills/
│   │   ├── checkin_checkout.skill.md
│   │   ├── taxi.skill.md
│   │   └── concierge.skill.md
│   ├── concierge_docs/
│   │   ├── one-day-in-athens.md
│   │   ├── family-day.md
│   │   └── rainy-day.md
│   └── data/
│       └── reservations.json  # Seeded PMS reservations
├── ui/
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── tests/
    └── scenarios.ts
```

---

## Security & Privacy

- **No secrets in repo** — use `.env` or environment variables.
- **Log redaction** — API keys and audio blobs are never logged; only transcripts and trace metadata are stored.
- **No sensitive data** — the agent is explicitly forbidden from asking for card numbers, CVV codes, passport numbers, or PINs.
- **Confirmation gates** — destructive actions (taxi booking, checkout) require explicit guest confirmation before execution.
- **Tool validation** — all tool arguments are validated with Zod schemas before execution; invalid args produce a `VALIDATION_ERROR` trace event.

---

## Optional Hosting Adapters (Not Implemented)

The core codebase is 100% host-agnostic. When you're ready to deploy on managed platforms, add thin adapter wrappers:

### Trigger.dev
Wrap `orchestrator.process()` in a `task()` definition. The orchestrator and all tools remain unchanged; Trigger.dev handles retries, scheduling, and observability.

### Vercel Edge Functions
Wrap routes in Next.js API routes or Vercel Functions. Note: SSE may need to use Vercel's streaming response API.

### AWS Lambda / Google Cloud Run
Wrap in a Lambda handler. Replace the in-memory `sessionStore` with a DynamoDB or Redis-backed implementation.

---

## Extending the Platform

| What to add | Where |
|-------------|-------|
| New tool (e.g. room service) | Add to `src/tools/`, register in `src/tools/registry.ts` |
| New skill SOP | Drop `*.skill.md` in `src/skills/` |
| New concierge doc | Drop `*.md` in `src/concierge_docs/`, run `npm run ingest` |
| New LLM backend | Implement `LLMClient` interface in `src/llm/`, add case to factory |
| Persistent sessions | Implement `ISessionStore` with Redis/Postgres, swap singleton in `sessionStore.ts` |
| Embeddings-based RAG | Update `conciergeIndex.ts`, add vector compute to `ingest.ts` |
