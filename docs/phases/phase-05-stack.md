# Phase 5: Stack and Service Management

Implements proposal 3 in full. Requires phase 4's `run()` for long commands. After this phase the
product works end to end against a real Docker host from a WebSocket client.

## Step 1: `common/stack.ts`

```ts
export const UNKNOWN = 0, DRAFT = 1, CREATED = 2, RUNNING = 3, EXITED = 4;
export interface StackSummary { name; status; managed; composeFileName }
export interface StackDetail extends StackSummary { composeYAML; composeENV; primaryHostname }
export interface ServiceInstance { name: string; status: string }

export function convertStatus(text: string): number;
```

```
convertStatus(text):                          # input like "exited(1), running(2)"
    t := text.toLowerCase()
    if t.startsWith("created"): return CREATED
    if t.includes("exited"):    return EXITED
    if t.startsWith("running"): return RUNNING
    return UNKNOWN
```

Table-driven tests over every observed `compose ls` status string.

## Step 2: `backend/stack/stack.ts`: paths, read, validate

```ts
export const COMPOSE_FILE_NAMES =
    ["compose.yaml", "docker-compose.yaml", "docker-compose.yml", "compose.yml"];
export function resolveStackPath(stacksDir: string, name: string): string;
export async function readStack(name: string): Promise<StackDetail>;
export function validateStackFiles(name, composeYAML, composeENV): void;
```

```
NAME_RE := /^[a-z0-9][a-z0-9_-]{0,62}$/

resolveStackPath(stacksDir, name):
    if not NAME_RE.test(name): throw AppError("validation", ..., "invalidStackName")
    full := path.resolve(stacksDir, name)
    if full != path.join(stacksDir, name):                    throw invalidStackName
    if not full.startsWith(stacksDir + path.sep):             throw invalidStackName
    return full
    # invariant: the containment check is independent of the regex; both always run.
    # Every caller that touches the filesystem goes through this function.

probeComposeFileName(dir):
    for candidate of COMPOSE_FILE_NAMES:
        if exists(dir + "/" + candidate): return candidate    # first hit wins, preserved on save
    return null

readStack(name):
    dir := resolveStackPath(stacksDir, name)
    if not exists(dir): throw AppError("notFound", ..., "stackNotFound")
    fileName := probeComposeFileName(dir) ?? "compose.yaml"
    composeYAML := readCapped(dir + "/" + fileName)           # cap 1 MiB
    composeENV  := readCapped(dir + "/.env")
    return { name, composeYAML, composeENV, composeFileName: fileName, ... }

readCapped(path):
    st := stat(path) or return ""
    if st.size > 1 MiB: throw AppError("validation", ..., "composeFileTooLarge")
    return readFile(path, "utf8")

validateStackFiles(name, composeYAML, composeENV):
    resolveStackPath-name-check(name)
    doc := YAML.parseDocument(composeYAML)
    if doc.errors.length > 0:
        throw AppError("validation", doc.errors[0].message, "invalidYAML")
    root := doc.toJS()
    if root is not plain object: throw AppError("validation", ..., "invalidCompose")
    if root.services is present and not plain object:
        throw AppError("validation", ..., "servicesMustBeObject")
    validateEnvText(composeENV)

validateEnvText(text):
    for line, i of text.split("\n"):
        trimmed := line.trim()
        if trimmed == "" or trimmed.startsWith("#"): continue
        if not line.includes("="):
            throw AppError("validation", "line " + (i+1), "invalidEnvFormat",
                           { line: i + 1 })                   # line number in values
```

## Step 3: `backend/stack/write.ts`: atomic writes

```ts
export async function writeAtomic(target: string, content: string, mode = 0o644): Promise<void>;
export async function writeStack(name, composeYAML, composeENV, isCreate): Promise<void>;
```

```
writeAtomic(target, content, mode):
    tmp := target + ".tmp-" + randomBase62(6)
    fd := await open(tmp, "wx", mode)                # wx: fail rather than reuse
    try:
        await fd.writeFile(content); await fd.sync(); await fd.close()
        await rename(tmp, target)
        dirFd := await open(dirname(target), "r"); await dirFd.sync(); await dirFd.close()
            # the directory fsync makes the rename durable
    catch e:
        try unlink(tmp); rethrow e
    # invariant: target is never observed partially written; failure leaves the old file

writeStack(name, composeYAML, composeENV, isCreate):
    dir := resolveStackPath(stacksDir, name)
    if isCreate:
        if exists(dir): throw AppError("conflict", ..., "stackAlreadyExists")
        mkdir(dir, 0o755); applyOwnership(config, dir)
    else if not exists(dir): throw stackNotFound

    fileName := probeComposeFileName(dir) ?? "compose.yaml"
    await writeAtomic(dir + "/" + fileName, composeYAML)
    applyOwnership(config, dir + "/" + fileName)
    if composeENV != "" or exists(dir + "/.env"):
        await writeAtomic(dir + "/.env", composeENV)          # invariant: an edit is never dropped
        applyOwnership(config, dir + "/.env")
```

Test the atomicity claim directly: kill the write between temp write and rename (inject a hook),
assert the original content is intact and no temp file leaks after cleanup.

## Step 4: `backend/stack/compose.ts`: args and the short runner

```ts
export function composeArgs(stack: { dir: string }, command: string, ...extra: string[]): string[];
export async function runCapture(argv: string[], cwd: string, timeoutMs: number): Promise<string>;
```

```
composeArgs(stack, command, ...extra):
    args := ["compose"]
    if exists(stacksDir + "/global.env"):
        args.push("--env-file", "../global.env")
        if exists(stack.dir + "/.env"): args.push("--env-file", "./.env")
        # order matters: the stack's own .env overrides global.env.
        # invariant: when no global.env exists, NO --env-file flags at all,
        # so compose's default .env behaviour applies unchanged.
    args.push(command, ...extra)
    return args

runCapture(argv, cwd, timeoutMs):
    child := spawn("docker", argv, { cwd, env: process.env })   # never a shell
    collect stdout, stderr, each capped at 4 MiB (stop buffering past the cap)
    timer := setTimeout(() => { child.kill("SIGKILL"); timedOut := true }, timeoutMs)
    await exit
    if timedOut: throw AppError("commandFailed", "timeout after " + timeoutMs + "ms")
    if code == "ENOENT" or spawn error:
        throw AppError("commandFailed", ..., "dockerUnavailable")
    if exitCode != 0:
        throw AppError("commandFailed", "exit " + exitCode + ": " + stderr.slice(0, 500),
                       "composeCommandFailed", { code: exitCode })
    return stdout
```

## Step 5: `backend/stack/registry.ts`: discovery and the status timer

```ts
export function createStackRegistry(ws, config): {
    snapshot(): Record<string, StackSummary>;
    markDirty(name: string): void;
    startRefreshTimer(): () => void;
    resolve(name: string): Stack;            // used by terminal.exec and the methods
};
```

```
state := { stacks: Map<name, Stack>, lastScanAt: 0, dirty: false }

scan():
    entries := readdir(stacksDir, { withFileTypes: true })
    next := Map()
    for e of entries where e.isDirectory() and NAME_RE.test(e.name):
        fileName := probeComposeFileName(stacksDir + "/" + e.name)
        if fileName == null: continue        # a directory without a compose file is not a stack
        prev := state.stacks.get(e.name)
        next.set(e.name, { name: e.name, composeFileName: fileName,
                           managed: true, status: prev?.status ?? DRAFT })
    keep unmanaged entries from state.stacks (they come from compose ls, not the disk)
    state.stacks := next; state.lastScanAt := now

refreshStatus():
    out := runCapture(["compose", "ls", "--all", "--format", "json"], stacksDir, 10_000)
    reset every managed stack's status to DRAFT           # absent from ls = not deployed
    for entry of JSON.parse(out):
        if entry.Name == "docknight": continue            # invariant: never manage ourselves
        stack := state.stacks.get(entry.Name)
        if stack is undefined:
            stack := { name: entry.Name, managed: false, composeFileName: "", status: UNKNOWN }
            state.stacks.set(entry.Name, stack)
        stack.status := convertStatus(entry.Status)
        stack.configFilePath := entry.ConfigFiles

tick():                                       # every 10 s, plus immediately after markDirty
    if state.dirty or now - state.lastScanAt > 60_000: scan(); state.dirty := false
    try refreshStatus() catch e: log.warn("stack", e)     # a failed tick never crashes the timer
    emitStackList()

emitStackList():
    payload := { stacks: Object.fromEntries(state.stacks) }
    ws.broadcastEvent(c => c.userId != null, "", "stackList", payload)
    # invariant: exactly one compose ls per tick regardless of connected client count
```

`startRefreshTimer` is called from `server.ts` per phase 1's startup order; the returned stop
function is called during shutdown before hooks run.

## Step 6: `backend/stack/lock.ts`

```ts
export function withStackLock<T>(name: string, fn: () => Promise<T>): Promise<T>;
```

```
locks := Map<name, Promise>
withStackLock(name, fn):
    if locks.has(name): throw AppError("conflict", ..., "operationInProgress")
    promise := fn()
    locks.set(name, promise)
    try: return await promise
    finally: locks.delete(name)
    # invariant: the error is thrown, not queued; the user sees "operation in progress"
```

## Step 7: `backend/stack/methods.ts`

```
runLong(conn, stack, command, extra, opts = {}):
    return withStackLock(stack.name, async () => {
        name := composeTerminalName(conn.endpoint, stack.name)
        exitCode := await terminals.run(name, "docker",
                        composeArgs(stack, command, ...extra), stack.dir, conn)
        if exitCode != 0:
            registry.markDirty(stack.name); emitStackList()   # state changed even on failure
            throw AppError("commandFailed", "exit " + exitCode,
                           "composeCommandFailed", { code: exitCode, terminal: name })
        registry.markDirty(stack.name); emitStackList()
        return { exitCode }
    })

method "stack.list"   (auth, routable): return { stacks: registry.snapshot() }

method "stack.get"    (auth, routable):
    parse: obj({ name: str })
    handle(conn, p):
        detail := readStack(p.name)
        detail.primaryHostname := Settings.get("primaryHostname")
        # side effect: fill the log pane without an extra round trip
        logs := logsTerminalName(conn.endpoint, p.name)
        terminals.getOrCreate(logs, "follow", "docker",
            composeArgs(stack, "logs", "-f", "--tail", "100"), stack.dir, GEOMETRY.follow)
        terminals.join(conn, logs)
        return { stack: detail }

method "stack.save"   (auth, routable):
    parse: obj({ name, composeYAML: str({max: 1 MiB}), composeENV: str({max: 1 MiB}),
                 isCreate: bool() })
    handle: validateStackFiles(...); await writeStack(...); registry.markDirty(name)
            emitStackList(); return { ok: true }

method "stack.deploy" (auth, routable):
    handle(conn, p):
        validateStackFiles(p.name, p.composeYAML, p.composeENV)
        await writeStack(p.name, p.composeYAML, p.composeENV, p.isCreate)
        join follow log terminal for conn (same as stack.get)
        return runLong(conn, stack, "up", ["-d", "--remove-orphans"])

method "stack.start":   runLong(conn, stack, "up", ["-d", "--remove-orphans"]) + join follow log
method "stack.stop":    terminals.leave(conn, logsTerminalName(...)); runLong(conn, stack, "stop", [])
method "stack.restart": runLong(conn, stack, "restart", [])
method "stack.down":    runLong(conn, stack, "down", [])

method "stack.update":
    handle(conn, p):
        withStackLock(p.name, async () => {
            pull := await terminals.run(composeTerminalName(...), "docker",
                        composeArgs(stack, "pull"), stack.dir, conn)
            if pull != 0: throw commandFailed
            refreshStatus()                   # re-read: was it running before the pull?
            if registry.snapshot()[p.name].status == RUNNING:
                up := await terminals.run(... "up", "-d", "--remove-orphans" ...)
                # invariant: update never starts a stopped stack
            markDirty; emitStackList; return { exitCode: 0 }
        })

method "stack.delete":
    handle(conn, p):
        withStackLock(p.name, async () => {
            dir := resolveStackPath(stacksDir, p.name)
            st := lstat(dir)
            if not st.isDirectory() or st.isSymbolicLink():
                throw AppError("validation", ..., "invalidStackName")
                # invariant: a planted symlink cannot redirect the removal
            code := await terminals.run(... "down", "--remove-orphans" ...)
            if code != 0:
                markDirty; emitStackList      # down may have partly run; show real state
                throw commandFailed
            await rm(dir, { recursive: true })  # only after down returned zero
            markDirty; emitStackList; return { exitCode: code }
        })

method "stack.serviceStatus" (auth, routable):
    handle(conn, p):
        out := runCapture(composeArgs(stack, "ps", "--format", "json"), stack.dir, 10_000)
        records := parsePsOutput(out)
            # handles BOTH shapes: one JSON array, or one JSON object per line.
            # a line that fails to parse is skipped, never fatal.
        services := group records by .Service ->
            [{ name: r.Name, status: r.Health or r.State }]
            # Health wins over State so healthcheck states surface
        return { services }

method "service.start"   (auth, routable): runLong(conn, stack, "up", ["-d", p.service])
method "service.stop":    runLong(conn, stack, "stop", [p.service])
method "service.restart": runLong(conn, stack, "restart", [p.service])
    # all three go through composeArgs, so a single service gets the same env as the stack

method "docker.stats" (auth, routable):
    handle:
        try:
            out := runCapture(["stats", "--format", "json", "--no-stream"], stacksDir, 15_000)
            return { stats: one record per line keyed by record.Name }
        catch e: log.warn("stack", e); return { stats: {} }   # degrade, never block the page

method "docker.networks" (auth, routable):
    handle:
        try: return { networks: sorted non-empty lines of
                      runCapture(["network", "ls", "--format", "{{.Name}}"], ..., 10_000) }
        catch e: log.warn; return { networks: [] }
```

## Step 8: Global env file

Replace phase 3's stubs:

```
GLOBAL_ENV_PLACEHOLDER := "# VARIABLE=value #comment"

readGlobalEnv():
    return readFile(stacksDir + "/global.env", "utf8") or GLOBAL_ENV_PLACEHOLDER

writeGlobalEnv(content):
    validateEnvText(content)
    if content.trim() == GLOBAL_ENV_PLACEHOLDER:
        unlink(stacksDir + "/global.env") if exists      # writing the placeholder deletes
    else:
        writeAtomic(stacksDir + "/global.env", content); applyOwnership(...)
```

Also wire `terminal.exec`'s stack resolution (phase 4 step 5) to `registry.resolve` now.

## Tests

Unit (no Docker): name policy table (traversal, dots, leading dash, 64 chars, uppercase),
containment with a crafted `..` name, env validation line numbers, `composeArgs` for all four
global/local env combinations, `convertStatus` table, `parsePsOutput` both shapes plus a garbage
line, atomic write kill-injection, lock conflict.

Integration (behind `DOCKER_TESTS=1`, skipped otherwise): create-deploy-stop-start-down-delete of a
one-service alpine stack against a real daemon, asserting terminal output arrives and `stackList`
events fire after each mutation.

## Done checklist

- [ ] Full lifecycle works from a raw WebSocket client against a dev Docker host.
- [ ] Two concurrent deploys of one stack: second gets `operationInProgress`.
- [ ] Deleting a stack whose directory is a symlink is refused.
- [ ] `docker.stats` failure leaves the stack page functional (empty map, warning logged).
- [ ] Kill -9 during a compose file save leaves the previous file intact.
