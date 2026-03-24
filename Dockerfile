# ── Arcane API — Production Dockerfile ───────────────────────────
# Single-stage build: compiles hedera, shared, then api in order.
# Works on Railway, Render, Fly.io, or any Docker host.

FROM node:22-alpine

# openssl is required by Prisma client at runtime
RUN apk add --no-cache openssl

WORKDIR /app

# ── 1. Copy package manifests first (layer cache for npm install) ─
COPY package.json package-lock.json ./
COPY apps/api/package.json           ./apps/api/
# apps/web/package.json must exist — root workspace glob is "apps/*"
COPY apps/web/package.json           ./apps/web/
COPY packages/hedera/package.json    ./packages/hedera/
COPY packages/shared/package.json    ./packages/shared/
# contracts package.json needed so npm workspace graph resolves cleanly
COPY packages/contracts/package.json ./packages/contracts/

# ── 2. Install ALL dependencies (dev included — needed for tsc) ───
RUN npm install \
      --workspace=@tradeagent/shared \
      --workspace=@tradeagent/hedera \
      --workspace=@tradeagent/api \
      --include-workspace-root \
      --ignore-scripts=false

# ── 3. Copy source code ───────────────────────────────────────────
COPY apps/api/        ./apps/api/
COPY packages/hedera/ ./packages/hedera/
COPY packages/shared/ ./packages/shared/

# ── 4. Build workspace packages then API (strict order) ──────────
# Each RUN layer persists dist/ for the next step — no COPY overwrites.
RUN npm run build --workspace=@tradeagent/shared
RUN npm run build --workspace=@tradeagent/hedera
# API build script already runs prisma generate internally
RUN npm run build --workspace=@tradeagent/api

# ── 5. Prune dev deps AFTER all builds are done ───────────────────
# dist/ folders in packages/* are NOT in node_modules, so prune
# only removes tsc, @types/*, etc. — compiled output is preserved.
RUN npm prune --omit=dev

EXPOSE 3001

CMD ["node", "apps/api/dist/apps/api/src/index.js"]
