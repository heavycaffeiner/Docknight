# Phase 11: Packaging, Version Check, Self Upgrade

Implements the deferred parts of proposal 0: the container image (4.3.9), the version check
(4.3.10), and the self upgrade (4.3.11). Last because the upgrade needs settings (phase 3) and the
terminal registry (phase 4), and the image should ship the verified product.

## Step 1: `docker/Dockerfile`

```
# stage 1: frontend, on the build platform (bundle is architecture-independent)
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend
    corepack enable pnpm
    COPY manifests; pnpm install --frozen-lockfile --ignore-scripts
    COPY sources;  pnpm build:frontend          # emits dist/frontend with .br/.gz siblings

# stage 2: deps, on the target platform (node-pty compiles against musl)
FROM node:24-alpine AS deps
    apk add --no-cache python3 make g++
    ENV npm_config_build_from_source=true
    COPY manifests; pnpm install --frozen-lockfile --prod

# stage 3: runtime
FROM node:24-alpine
    apk add --no-cache docker-cli docker-cli-compose
    WORKDIR /app
    COPY backend/ common/ scripts/ package.json ./...
    COPY --from=deps node_modules ./node_modules
    COPY --from=frontend dist/frontend ./dist/frontend
    COPY docker/healthcheck.ts ./docker/
    ENV DOCKNIGHT_IS_CONTAINER=1
    EXPOSE 5001
    VOLUME /app/data
    HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "docker/healthcheck.ts"]
    CMD ["node", "backend/index.ts"]
```

```
docker/healthcheck.ts:
    port := parseInt(process.env.DOCKNIGHT_PORT ?? "5001")
    socket := net.connect(port, "127.0.0.1")
    on connect: socket.end(); exit 0
    on error or 3 s timeout: exit 1
    # no auth, no HTTP, no application state
```

`docker/compose.yaml`: the reference deployment from proposal 0 verbatim.

## Step 2: `backend/version.ts` (version check)

```ts
export function startVersionCheck(config: Readonly<Config>): () => void;   // returns stop
export function getLatestVersion(): string | undefined;
```

```
latestVersion := undefined            # process state; starts unset so a fresh process
                                      # reports nothing until the first check completes

startVersionCheck(config):
    check(config)                     # once at startup, not awaited
    timer := setInterval(() => check(config), 48 h); timer.unref()
    return () => clearInterval(timer)

check(config):
    if Settings.get("checkUpdate") != true: return        # read per check: toggling the
                                                          # setting needs no restart, and no
                                                          # request happens while it is off
    try:
        manifest := await fetch(config.versionManifestUrl, { signal: timeout(10_000) }).json()
        candidate := manifest.stable
        if Settings.get("checkBeta") and isNewer(manifest.beta, manifest.stable):
            candidate := manifest.beta
        if not parsesAsVersion(candidate): return
        latestVersion := candidate
        emit info to authenticated conns (latestVersion changed)
        if isNewer(candidate, VERSION) and Settings.get("autoUpgrade"):
            if not upgradeInFlight: startUpgrade(config, null)
    catch e:
        log.info("version", "check failed: " + e.message)  # never fatal, state unchanged

isNewer(a, b): numeric compare of dot-separated parts; non-parsing -> false
```

## Step 3: `backend/upgrade.ts` (self upgrade)

```ts
export async function resolveTarget(config): Promise<Target | { reason: string }>;
export async function startUpgrade(config, conn: Conn | null): Promise<{ terminal: string }>;
export function upgradeStatus(): UpgradeStatusPayload;
```

```
resolveTarget(config):
    if not config.isContainer:                 return { reason: "upgradeNotContainer" }
    if not exists("/var/run/docker.sock"):     return { reason: "upgradeNoSocket" }

    id := selfContainerId()
        # try in order: /proc/self/mountinfo (docker containers/<id> pattern),
        # /proc/self/cgroup, then hostname if /^[0-9a-f]{12}$/
    if id is null:                             return { reason: "upgradeSelfUnknown" }

    inspect := JSON.parse(runCapture(["inspect", "--format", "{{json .Config}}", id], ...))
    labels := inspect.Labels
    project     := labels["com.docker.compose.project"]
    service     := labels["com.docker.compose.service"]
    workingDir  := labels["com.docker.compose.project.working_dir"]
    configFiles := labels["com.docker.compose.project.config_files"].split(",")
    if any missing:                            return { reason: "upgradeNotCompose" }
    for p of [workingDir, ...configFiles]:
        if not p.startsWith("/") or p.includes("\n"):
            return { reason: "upgradeNotCompose" }
        # paths are interpolated into the helper's shell string; reject anything odd
    return { image: inspect.Image, project, service, workingDir, configFiles }

state := { running: false, lastError: undefined }

startUpgrade(config, conn):
    if state.running: throw AppError("conflict", "upgrade already running")
    target := resolveTarget(config)
    if target.reason: throw AppError("validation", target.reason, target.reason)

    state.running := true; state.lastError := undefined
    composeBase := ["compose", "--project-directory", target.workingDir,
                    ...flatten(["-f", f] for f of target.configFiles)]

    pull := terminals.run(UPGRADE_TERMINAL, "docker",
                          [...composeBase, "pull", target.service],
                          target.workingDir, conn)
    pull.then(code => {
        if code != 0:
            state.running := false
            state.lastError := "upgradePullFailed"     # survives the terminal's deletion
            return
        # handoff: this process dies mid-way by design
        sq := s => "'" + s.replace(/'/g, `'\\''`) + "'"   # POSIX single-quote
        inner := "sleep 3; exec docker compose --project-directory " + sq(workingDir)
               + configFiles.map(f => " -f " + sq(f)).join("")
               + " up --detach " + sq(service)
        volumes := ["-v", "/var/run/docker.sock:/var/run/docker.sock"]
        for dir of unique(dirname of each configFile + workingDir):
            volumes.push("-v", dir + ":" + dir)          # same path both sides
        spawn("docker", ["run", "--detach", "--rm", ...volumes,
                         "--entrypoint", "sh", target.image, "-c", inner],
              { detached: true, stdio: "ignore" }).unref()
    })
    return { terminal: UPGRADE_TERMINAL }
    # resolves once the pull has STARTED; there is no later moment to answer from

method "upgrade.status" (auth, not routable):
    t := resolveTarget(config)
    return { supported: !t.reason, reason: t.reason,
             image: t.image, running: state.running,
             terminal: UPGRADE_TERMINAL, lastError: state.lastError }

method "upgrade.start" (auth, not routable):
    return startUpgrade(config, conn)
```

## Step 4: Release CI

```
.github/workflows/verify.yml, image job:
    docker/setup-qemu + setup-buildx
    build linux/amd64,linux/arm64 with docker/build-push-action
    login to GHCR and push ONLY when github.event_name == "push"
        # fork PRs have no token; the build itself still runs and gates
    tags: ghcr.io/heavycaffeiner/docknight:latest + :<version> on a version tag

version.json at the repo root: { "stable": "<current>" }, updated as part of a release commit.
```

## Step 5: Wiring and README

```
server.ts startup: startVersionCheck(config) after listen (per phase 1's sequence);
                   its stop function joins the shutdown path before hooks run.
Settings screen (phase 9) already renders upgrade.status; verify against a real container.

README: restore the install / update / backup / locked-out / configuration sections from the
pre-rewrite README, now accurate against the implementation, keeping the /opt/stacks
identical-path warning and the agent-key backup warning. Update README.ko.md to match.
```

## Tests

```
- healthcheck: exit 0 against a listening port, exit 1 against a closed one (plain node test)
- isNewer table: 1.6.2 vs 1.10.0, beta suffixes, garbage input
- version check: manifest fetch mocked; checkUpdate=false makes zero requests;
  checkBeta picks the newer beta; failure leaves latestVersion unchanged
- resolveTarget: fixture /proc files and mocked inspect output for each failure reason;
  a config path containing a newline -> upgradeNotCompose
- shell quoting: a workingDir containing spaces and a single quote round-trips through sq()
- image: docker build completes for both platforms in CI; container starts, healthcheck
  goes healthy, first-run setup reachable on 5001
- manual (release checklist, not CI): deploy the reference compose on a VM, press Upgrade,
  confirm the container is replaced and the browser reconnects
```

## Done checklist

- [ ] `docker compose up -d` with the reference file yields a working instance from scratch.
- [ ] `PUID/PGID` set: files created in /opt/stacks owned by that uid/gid.
- [ ] `upgrade.status` reports `upgradeNotCompose` for a `docker run`-started container and
      supported for the reference deployment.
- [ ] Auto-upgrade path: version check with a newer manifest and autoUpgrade on triggers one
      upgrade, and a second check while running skips.
- [ ] Full `pnpm verify` plus the layout and a11y matrices green on the release commit.
