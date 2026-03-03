# ── Stage 1: Build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json package-lock.json* ./

# Install ALL deps (including devDeps needed to compile TypeScript)
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Stage 2: Production image ──────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Copy only production deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JS from builder
COPY --from=builder /app/dist ./dist

# Copy runtime assets (UI, skills, concierge docs, seed data)
COPY ui/ ./ui/
COPY src/skills/ ./src/skills/
COPY src/concierge_docs/ ./src/concierge_docs/
COPY src/data/ ./src/data/

# Non-root user for security
RUN addgroup -S hotelbot && adduser -S hotelbot -G hotelbot
USER hotelbot

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/server/index.js"]
