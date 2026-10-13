# syntax=docker/dockerfile:1

FROM node:24.21.0-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24.21.0-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:24.21.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV WHOOP_DB_PATH=/app/data/whoop.db

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs athlete \
  && mkdir -p /app/data \
  && chown -R athlete:nodejs /app

COPY --from=builder --chown=athlete:nodejs /app/dist ./dist
COPY --from=builder --chown=athlete:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=athlete:nodejs /app/package.json ./package.json

USER athlete
EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "dist/server/index.js"]
