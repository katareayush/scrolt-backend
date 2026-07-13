# syntax=docker/dockerfile:1

# ── deps ────────────────────────────────────────────────────────────
# Full install (incl. dev) so we can compile TypeScript.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── build ───────────────────────────────────────────────────────────
# Compile src/ → dist/ (tsc). Scripts compile too, so migrations run
# from the image without ts-node (dist/scripts/migrate.js).
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────
# Production deps only + compiled output + drizzle SQL for migrations.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# migrate.ts reads migrationsFolder: './drizzle' relative to CWD.
COPY drizzle ./drizzle

# Drop root.
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
USER nodejs

EXPOSE 4000

# Liveness: /health touches no dependencies, so this stays green even
# when DB/Redis are cold. Node 24 ships global fetch.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
