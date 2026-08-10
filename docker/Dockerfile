# syntax=docker/dockerfile:1

# Build stage: the frontend bundle is the only build output; the backend runs from source.
FROM node:24-bookworm-slim AS build
WORKDIR /build

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vite.config.ts svelte.config.js ./
COPY common ./common
COPY frontend ./frontend
COPY tools ./tools
RUN pnpm run build:frontend

# Prune to what the running process needs.
RUN pnpm prune --prod


FROM node:24-bookworm-slim AS runtime

# The Docker CLI and the Compose v2 plugin. Docknight shells out to them; it never talks to the
# Engine API directly.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && apt-get purge -y --auto-remove gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist
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
