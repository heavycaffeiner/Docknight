# The frontend bundle is architecture-independent: build it once on the build platform so it
# never runs through QEMU emulation, no matter how many target platforms the runtime stage builds.
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json vite.config.ts ./
COPY common ./common
COPY frontend ./frontend
COPY tools/theme ./tools/theme
RUN pnpm build:frontend

# node-pty compiles a native addon against musl on this stage's own target platform, so it
# cannot be built on $BUILDPLATFORM and copied across architectures the way the frontend is.
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
ENV npm_config_build_from_source=true
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine
RUN apk add --no-cache docker-cli docker-cli-compose
WORKDIR /app
COPY package.json ./
COPY backend ./backend
COPY common ./common
COPY scripts ./scripts
COPY docker/healthcheck.ts ./docker/healthcheck.ts
COPY --from=deps /app/node_modules ./node_modules
COPY --from=frontend /app/dist/frontend ./dist/frontend
ENV DOCKNIGHT_IS_CONTAINER=1
EXPOSE 5001
VOLUME /app/data
HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "docker/healthcheck.ts"]
CMD ["node", "backend/index.ts"]
