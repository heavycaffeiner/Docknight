# Phase 1: Foundation

Implements proposal 0 sections 4.3.1 through 4.3.7 (configuration, data directory, database,
migrations, logging, HTTP serving, lifecycle). The container image, version check, and self upgrade
from proposal 0 are deferred to phase 11 because they need settings and terminals.

Deliverable: a process that starts, serves a placeholder frontend, owns its database, and shuts
down cleanly. No WebSocket yet.

## Step 1: Repository skeleton

```
package.json
    name docknight, private, type module
    packageManager: pnpm@<pinned>
    engines.node: >= 24
    scripts:
        dev:backend    -> node backend/index.ts --data-dir .dev/data --stacks-dir .dev/stacks
        dev:frontend   -> vite dev            (wired in phase 8)
        build:frontend -> vite build          (wired in phase 8)
        typecheck      -> tsc --noEmit
        lint           -> eslint .
        test           -> node --test
        verify         -> typecheck + lint + test

tsconfig.json
    strict, module nodenext, target es2024, verbatimModuleSyntax true
    noEmit true                       # backend runs through type stripping
    allowImportingTsExtensions true, rewriteRelativeImportExtensions false
    include: backend, common, frontend/src, scripts, tools, tests

eslint.config.js
    base: typescript-eslint recommended
    rule: no-restricted-imports in common/** blocking backend/*, frontend/*, node:*
    rule: no-restricted-syntax blocking enum, namespace, parameter properties
    rule (custom or no-restricted-syntax): template literals passed to db run/one/all/tx
          must not contain ${}     # SQL is always a constant string

directories
    backend/  common/  frontend/  docker/  scripts/  docs/
    frontend/index.html   placeholder page so the static handler has something to serve
```

Done when `pnpm verify` passes on the empty skeleton.

## Step 2: `backend/config.ts`

```ts
export interface Config {
    port: number; hostname?: string;
    dataDir: string; stacksDir: string;
    enableConsole: boolean;
    sslKey?: string; sslCert?: string; sslKeyPassphrase?: string;
    logLevel: "debug" | "info" | "warn" | "error";
    puid?: number; pgid?: number;
    isContainer: boolean;
    versionManifestUrl: string;
}
export class ConfigError extends Error {}
export function loadConfig(argv: string[], env: NodeJS.ProcessEnv): Readonly<Config>;
```

```
loadConfig(argv, env):
    parsed := util.parseArgs({ args: argv.slice(2), options: KNOWN_FLAGS, strict: true })
        # strict: true makes an unknown CLI flag throw -> wrap into ConfigError

    resolve(key):                            # invariant: precedence CLI > env > default
        return parsed.values[cliName(key)] ?? env[envName(key)] ?? DEFAULTS[key]

    port := parseInt(resolve("port"))
    if port is NaN or port < 1 or port > 65535:
        throw ConfigError("port: expected 1-65535, got " + raw)

    dataDir   := path.resolve(resolve("dataDir"))
    stacksDir := path.resolve(resolve("stacksDir"))
    if dataDir == stacksDir
       or dataDir.startsWith(stacksDir + sep)
       or stacksDir.startsWith(dataDir + sep):
        throw ConfigError("dataDir and stacksDir must not overlap")   # invariant

    if exactly one of sslKey, sslCert is set:
        throw ConfigError("sslKey and sslCert must be set together")

    if exactly one of PUID, PGID is set: ignore both (they only act as a pair)
    if both set: parse as non-negative integers, else ConfigError

    enableConsole := parseBool(resolve("enableConsole"))   # "true"/"1" true, else false
    logLevel      := resolve("logLevel"); must be one of the four, else ConfigError
    isContainer   := env.DOCKNIGHT_IS_CONTAINER == "1"

    return Object.freeze(config)
```

Tests (`backend/config.test.ts`): precedence for every key, each validation failure, the overlap
check in both directions, unknown flag rejection, unknown env var ignored.

## Step 3: `backend/log.ts`

```ts
export function initLogging(level: LogLevel): void;
export const log: Record<LogLevel, (scope: string, ...args: unknown[]) => void>;
```

```
format(level, scope, args):
    line := isoTimestamp() + " " + pad(level.toUpperCase(), 5) + " [" + scope + "] "
    for arg in args:
        if arg is object: arg := redact(structuredClone-ish shallow copy)
        line += inspect(arg, { depth: 3 }) or String(arg)
    return line

redact(value, depth = 0):                    # invariant: credentials never reach output
    if depth > 4 or value is not plain object/array: return value
    for key in value:
        if /pass|secret|token|authorization/i.test(key): value[key] := "[redacted]"
        else: value[key] := redact(value[key], depth + 1)
    return value

log.<level>(scope, ...args):
    if levelRank < configuredRank: return
    try: write format(...) + "\n" to stdout (debug, info) or stderr (warn, error)
    catch: write String(args) best-effort; never throw    # invariant: logger never throws
```

Tests: level filtering, redaction of nested keys, non-throwing on circular objects.

## Step 4: `backend/directories.ts`

```ts
export class DataDirError extends Error {}
export async function prepareDirectories(config: Readonly<Config>): Promise<void>;
export async function applyOwnership(config: Readonly<Config>, path: string): Promise<void>;
```

```
prepareDirectories(config):
    for dir in [config.dataDir, config.stacksDir]:
        mkdir(dir, recursive)
        st := lstat(dir)
        if not st.isDirectory(): throw DataDirError(dir + " is not a directory")
        probe := dir + "/.write-probe"
        try: writeFile(probe, ""); unlink(probe)
        catch e: throw DataDirError(dir + " is not writable: " + e.code)
            # message names the path; read-only bind mounts are the common mistake

applyOwnership(config, path):
    if config.puid is undefined or config.pgid is undefined: return
    chown(path, puid, pgid)          # called by stack layer after every create, phase 5
```

## Step 5: `backend/db/index.ts` and migrations

```ts
export function openDatabase(config: Readonly<Config>): DatabaseSync;
export function run(sql: string, params?: Record<string, SQLInputValue>): void;
export function one<T>(sql: string, params?: Record<string, SQLInputValue>): T | undefined;
export function all<T>(sql: string, params?: Record<string, SQLInputValue>): T[];
export function tx<T>(fn: () => T): T;
export class MigrationError extends Error {}
export function runMigrations(db: DatabaseSync): void;
```

```
openDatabase(config):
    db := new DatabaseSync(config.dataDir + "/docknight.db")
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA foreign_keys = ON")
    db.exec("PRAGMA synchronous = NORMAL")
    db.exec("PRAGMA busy_timeout = 5000")
    module-level handle := db
    return db

run/one/all(sql, params):
    stmt := prepareCache.get(sql) or db.prepare(sql)     # small Map cache, keyed by sql text
    bind named params; execute; return per contract

tx(fn):
    db.exec("BEGIN IMMEDIATE")
    try: result := fn(); db.exec("COMMIT"); return result
    catch e: db.exec("ROLLBACK"); throw e

runMigrations(db):
    db.exec(CREATE TABLE IF NOT EXISTS migration ...)      # runner bookkeeping, not a migration
    applied := set of versions from migration table
    modules := import each backend/db/migrations/NNN-*.ts, sorted ascending by NNN
        # static import list in migrations/index.ts; the backend has no bundler glob
    for version in applied not present in modules:
        log.warn("db", "migration " + version + " in database but not in tree")   # keep going
    for module in modules where module.version not in applied:
        tx(() => {
            module.up(db)
            run("INSERT INTO migration ...", { version, name, applied_at: now })
        })                                   # a throw rolls back and becomes MigrationError
        log.info("db", "applied migration " + module.version + "-" + module.name)
```

`backend/db/migrations/001-initial.ts`: the four `STRICT` tables from proposal 0 section 4.2,
verbatim, plus the `session_user_id` index.

Tests: pragma values after open, `tx` rollback on throw, migration ordering, partial-failure
rollback (a migration that throws leaves no row in `migration`), warning path for unknown applied
versions.

## Step 6: `backend/http.ts`

```ts
export function createHttpServer(config: Readonly<Config>, upgradeHook: UpgradeHandler): Server;
```

```
createHttpServer(config, upgradeHook):
    handler(req, res):
        set on every response:
            X-Content-Type-Options: nosniff
            Referrer-Policy: same-origin
            X-Frame-Options: SAMEORIGIN

        if req.url == "/robots.txt" and GET:
            -> 200 text/plain "User-agent: *\nDisallow: /"

        if GET and url maps to a file under dist/frontend/:
            path := safe join, reject any resolved path escaping dist/frontend   # invariant
            if hashed asset (matches /\.[0-9a-f]{8,}\./):
                Cache-Control: public, max-age=31536000, immutable
            else: Cache-Control: no-cache
            if Accept-Encoding allows br and file + ".br" exists: serve it, Content-Encoding: br
            else if gzip allowed and ".gz" exists: serve it
            else: serve the file
            Content-Type from a small extension map

        if GET (anything else): serve dist/frontend/index.html, 200, no-cache
        else: -> 405

    server := (config.sslKey and config.sslCert)
        ? https.createServer({ key, cert, passphrase }, handler)
        : http.createServer(handler)
    server.on("upgrade", upgradeHook)        # phase 2 claims /ws here
    return server
```

Tests: header presence, SPA fallback for a deep path, 405 for POST to an unknown path, traversal
attempt (`/../../etc/passwd`) rejected, precompressed selection.

## Step 7: `backend/server.ts` and `backend/index.ts`

```ts
export interface Services { /* grown by later phases */ shutdownHooks: Array<() => Promise<void>> }
export async function start(config: Readonly<Config>): Promise<RunningServer>;
export interface RunningServer { stop(signal: string): Promise<void>; }
```

```
index.ts main():
    config := loadConfig(process.argv, process.env)     # ConfigError -> stderr, exit 1
    initLogging(config.logLevel)
    running := await start(config)                      # DataDirError/MigrationError -> exit 1
    process.on("SIGINT",  s => running.stop(s))
    process.on("SIGTERM", s => running.stop(s))
    process.on("unhandledRejection", e => log.error("process", e))   # log, do not exit
    process.on("uncaughtException",  e => log.error("process", e))

start(config):
    await prepareDirectories(config)
    db := openDatabase(config); runMigrations(db)
    services := buildServices(config, db)               # empty container in this phase
    server := createHttpServer(config, noopUpgrade)
    await listen(server, config.port, config.hostname)  # EADDRINUSE -> log, exit 1
    log.info("server", "listening on " + (hostname ?? "0.0.0.0") + ":" + port)
    return { stop }

stop(signal):                                # invariant: runs at most once; ordered
    if stopping: return stopPromise
    log.info("server", "shutdown requested by " + signal)
    hardTimer := setTimeout(() => process.exit(1), 30_000); hardTimer.unref()
    server.close()                           # stop accepting new connections
    stop refresh + version timers            # registered by later phases via services
    for hook in services.shutdownHooks:      # phase 2 adds WS close, phase 4 pty close,
        await hook()                         # phase 6 agent links; order of registration
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    db.close()
    process.exit(0)
```

The hook order is the shutdown order: hooks are registered in dependency order as phases add them
(WS first, then terminals, then agent links), and the database always closes last.

## Done checklist

- [ ] `pnpm dev:backend` starts, creates `.dev/data` and `.dev/stacks`, serves the placeholder
      page on 5001, and `Ctrl+C` exits 0 within a second.
- [ ] Second start against the same data dir applies no migrations and starts clean.
- [ ] `--port 70000`, overlapping dirs, and a read-only data dir each abort with a named message.
- [ ] All unit tests pass; no module outside `config.ts` reads `process.env`.
