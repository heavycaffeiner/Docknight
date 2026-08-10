# syntax=docker/dockerfile:1

# The frontend bundle is the only build output; the backend runs from source. It is also
# architecture independent, so it is built natively even when the image targets another
# architecture. --ignore-scripts skips the native module, which this stage never loads.
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend
WORKDIR /build

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json vite.config.ts svelte.config.js ./
COPY common ./common
COPY frontend ./frontend
COPY tools ./tools
RUN pnpm run build:frontend

# Runtime dependencies for the image's own architecture. node-pty is compiled here rather than
# taken from a prebuild, because the published prebuilds link against glibc and this image is musl.
FROM node:24-alpine AS deps
WORKDIR /build

RUN corepack enable \
    && apk add --no-cache python3 make g++

ENV npm_config_build_from_source=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS runtime

LABEL org.opencontainers.image.source="https://github.com/heavycaffeiner/Docknight" \
      org.opencontainers.image.description="Self-hosted web manager for docker compose stacks" \
      org.opencontainers.image.licenses="MIT"

# The Docker CLI and the Compose v2 plugin. Docknight shells out to them; it never talks to the
# Engine API directly.
RUN apk add --no-cache docker-cli docker-cli-compose

WORKDIR /app

COPY --from=deps /build/node_modules ./node_modules
COPY --from=frontend /build/dist ./dist
COPY package.json tsconfig.json ./
COPY common ./common
COPY backend ./backend
COPY scripts ./scripts
COPY docker/healthcheck.ts ./docker/healthcheck.ts

ENV NODE_ENV=production \
    DOCKNIGHT_IS_CONTAINER=1 \
    DOCKNIGHT_PORT=5001 \
    DOCKNIGHT_DATA_DIR=/app/data \
    DOCKNIGHT_STACKS_DIR=/opt/stacks

EXPOSE 5001
VOLUME /app/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "/app/docker/healthcheck.ts"]

CMD ["node", "backend/index.ts"]
