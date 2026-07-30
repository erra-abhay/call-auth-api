# ──────────────────────────────────────────────────────────────
# Optimus — call-auth-api Dockerfile
# Multi-stage: build (prune devDeps) → lean runtime image
# Node 22 LTS (Alpine) for smallest footprint
# ──────────────────────────────────────────────────────────────

# Stage 1: deps — install production dependencies only
FROM node:22-alpine AS deps

# argon2 needs build tools (native bindings)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./

# Install prod deps only (no nodemon etc.)
RUN npm ci --omit=dev

# Stage 2: runtime
FROM node:22-alpine AS runner

WORKDIR /app

# Non-root user for security
RUN addgroup -g 1001 -S optimus && \
    adduser  -u 1001 -S optimus -G optimus

# Copy production deps from stage 1
COPY --from=deps --chown=optimus:optimus /app/node_modules ./node_modules

# Copy source (everything except what's in .dockerignore)
COPY --chown=optimus:optimus . .

USER optimus

EXPOSE 8080

ENV NODE_ENV=production \
    PORT=8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1))"

CMD ["node", "index.js"]
