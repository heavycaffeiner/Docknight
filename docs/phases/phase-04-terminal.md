# Phase 4: Terminal Subsystem

Implements proposal 4 in full. Independent of phase 3 (auth) except that the methods carry
`requiresAuth: true`, which the router already enforces generically.

## Step 1: `common/terminal.ts`

```ts
export type TerminalKind = "command" | "follow" | "exec" | "host";

export const GEOMETRY: Record<TerminalKind, { cols: number; rows: number }> = {
    command: { cols: 105, rows: 8 },
    follow:  { cols: 105, rows: 20 },
    exec:    { cols: 105, rows: 24 },
    host:    { cols: 105, rows: 40 },
};

export const composeTerminalName = (endpoint: string, stack: string) =>
    `compose-${endpoint}-${stack}`;
export const logsTerminalName = (endpoint: string, stack: string) =>
    `logs-${endpoint}-${stack}`;
export const execTerminalName = (endpoint: string, stack: string, service: string, connId: string) =>
    `exec-${endpoint}-${stack}-${service}-${connId}`;
export const hostShellName = (connId: string) => `shell-${connId}`;
export const UPGRADE_TERMINAL = "upgrade";
```

Shared with the frontend so both sides construct identical names; no Node API here.

## Step 2: `backend/terminal/ring-buffer.ts`

```ts
export class RingBuffer {
    constructor(maxChunks: number, maxBytes: number);
    push(chunk: string): void;
    join(): string;
}
```

```
push(chunk):
    chunks.push(chunk); bytes += byteLength(chunk)
    while chunks.length > maxChunks or bytes > maxBytes:
        dropped := chunks.shift(); bytes -= byteLength(dropped)
    # invariant: bytes never exceeds maxBytes after push returns (a single oversized
    # chunk is truncated from its front to maxBytes before insertion)
```

Tests: chunk cap, byte cap, single chunk larger than the byte cap, join order.

## Step 3: `backend/terminal/terminal.ts`

One pty plus subscribers. Registry construction is step 4; this module holds the state shape and
the process handling.

```ts
export interface TerminalState { /* per proposal 4 section 4.2 */ }
export function spawnTerminal(name, kind, file, args, cwd, geometry,
                              onData, onExit): TerminalState;
export function closeTerminal(state: TerminalState): void;
```

```
spawnTerminal(...):
    pty := nodePty.spawn(file, args, {
        name: "xterm-256color", cwd, env: process.env,
        cols: geometry.cols, rows: geometry.rows,
    })
    # spawn throwing (missing binary) is caught by the caller and mapped to
    # commandFailed "terminalSpawnFailed" plus a synthetic terminalExit 127
    state := { name, kind, pty, cols, rows,
               buffer: new RingBuffer(200, 256 * 1024),
               subscribers: new Set(), exited: false, exitCode: null, idleSince: null }
    pty.onData(chunk => { state.buffer.push(chunk); onData(state, chunk) })
    pty.onExit(({ exitCode }) => onExit(state, exitCode))
    return state

closeTerminal(state):
    if state.exited: return
    state.pty.write("\x03")
    setTimeout(2 s):  if not state.exited: state.pty.kill("SIGTERM")
    setTimeout(5 s):  if not state.exited: state.pty.kill("SIGKILL")
    # invariant: escalation always reaches SIGKILL; timers are unref'd and cancelled on exit
```

## Step 4: `backend/terminal/registry.ts`

```ts
export function createTerminalRegistry(ws: WsLayer): {
    run(name, file, args, cwd, joinFor: Conn | null, geometry): Promise<number>;
    has(name: string): boolean;
    getOrCreate(name, kind, file, args, cwd, geometry): TerminalState;
    join(conn: Conn, name: string): { buffer: string; exited: boolean; exitCode: number | null };
    leave(conn: Conn, name: string): void;
    input(conn: Conn, name: string, data: string): void;
    resize(conn: Conn, name: string, cols: number, rows: number): void;
    detachConnection(conn: Conn): void;
    closeAll(): Promise<void>;
};
```

```
registry := Map<name, TerminalState>
pendingRuns := Map<name, { resolve }>

onData(state, chunk):
    for conn in state.subscribers:
        ws.sendEvent(conn, conn.endpoint == state ownerEndpoint ? "" : ..., "terminalWrite",
                     { terminal: state.name, data: chunk })
        # in practice: emit with endpoint "" locally; relay stamping is phase 6's job

finish(state, exitCode):
    state.exited := true; state.exitCode := exitCode
    for conn in state.subscribers:
        ws.sendEvent(conn, "", "terminalExit", { terminal: state.name, exitCode })
    registry.delete(state.name)              # invariant: name reusable immediately after exit
    pendingRuns.get(state.name)?.resolve(exitCode); pendingRuns.delete(state.name)

getOrCreate(name, kind, file, args, cwd, geometry):
    existing := registry.get(name)
    if existing and not existing.exited: return existing    # never restarts a live pty
    state := spawnTerminal(name, kind, file, args, cwd, geometry, onData, finish)
    registry.set(name, state)
    return state

run(name, file, args, cwd, joinFor, geometry = GEOMETRY.command):
    if registry.has(name): throw AppError("conflict", ..., "terminalBusy")
    state := getOrCreate(name, "command", file, args, cwd, geometry)
    if joinFor: join(joinFor, name)
    return new Promise(resolve => pendingRuns.set(name, { resolve }))
    # invariant: resolves with the exit code even if every subscriber left first

join(conn, name):
    state := registry.get(name)
    if state is null: return { buffer: "", exited: false, exitCode: null }
        # invariant: joining a not-yet-created terminal is a normal case, not an error
    state.subscribers.add(conn); conn.joinedTerminals.add(name)
    state.idleSince := null
    return { buffer: state.buffer.join(), exited: state.exited, exitCode: state.exitCode }

leave(conn, name):
    state := registry.get(name); if null: return
    state.subscribers.delete(conn); conn.joinedTerminals.delete(name)
    if state.subscribers.size == 0:
        state.idleSince := now
        if state.kind in ["exec", "host"]: closeTerminal(state)
            # explicit leave = the user navigated away; a private shell dies at once

detachConnection(conn):                      # from the socket close handler, synchronous
    for name of conn.joinedTerminals:
        conn.joinedTerminals.delete(name)
        state := registry.get(name); if null: continue
        state.subscribers.delete(conn)
        if state.subscribers.size == 0: state.idleSince := now
    # invariant: closes nothing; a dead socket is not a departed viewer.
    # The idle sweeper reaps what nobody rejoins.

idle sweeper, every 30 s:
    for state of registry.values() where state.subscribers.size == 0 and state.idleSince:
        idle := now - state.idleSince
        if state.kind == "follow" and idle > 60_000:  closeTerminal(state)
        if state.kind in ["exec", "host"] and idle > 120_000: closeTerminal(state)
        # "command" is never reaped; it runs to completion

input(conn, name, data):
    state := registry.get(name)
    if state is null: throw AppError("notFound", ..., "terminalNotFound")
    if state.kind in ["command", "follow"]:
        throw AppError("validation", ..., "terminalNotInteractive")
    if not state.subscribers.has(conn):
        throw AppError("unauthorized", ..., "terminalNotJoined")
        # invariant: membership checked on every write; names are guessable
    state.pty.write(data)

resize(conn, name, cols, rows):
    state := registry.get(name); if null: return          # resize after exit is not an error
    if not state.subscribers.has(conn): throw terminalNotJoined
    cols := clamp(int(cols), 20, 500); rows := clamp(int(rows), 5, 200)
    state.cols := cols; state.rows := rows; state.pty.resize(cols, rows)

closeAll():
    for state of registry.values(): closeTerminal(state)
    await all exited or 6 s
    # registered as a shutdown hook AFTER the WS hook, BEFORE the database close
```

## Step 5: `backend/terminal/methods.ts`

```
method "terminal.join"  (auth, routable):
    parse: obj({ terminal: str({ max: 256 }) })
    handle: registry.join(conn, p.terminal)

method "terminal.leave" (auth, routable):
    handle: registry.leave(conn, p.terminal); return { ok: true }

method "terminal.input" (auth, routable):
    parse: obj({ terminal: str, data: str({ max: 65536 }) })
    handle: registry.input(conn, p.terminal, p.data); return { ok: true }

method "terminal.resize" (auth, routable):
    parse: obj({ terminal: str, cols: num({ int: true }), rows: num({ int: true }) })
    handle: registry.resize(...); return { ok: true }

method "terminal.exec" (auth, routable):
    parse: obj({ stack: str, service: str({ max: 128 }), shell: str })
    handle(conn, p):
        if p.shell not in ["sh", "bash", "ash", "zsh"]:
            throw AppError("validation", ..., "unsupportedShell")
        stack := stackLayer.resolve(p.stack)              # phase 5; until then a test stub
        services := parse stack compose file services keys
        if p.service not in services:
            throw AppError("notFound", ..., "serviceNotFound")
            # invariant: the service must exist in THIS stack's file; no cross-stack reach
        name := execTerminalName(conn.endpoint, p.stack, p.service, conn.id)
        getOrCreate(name, "exec", "docker",
                    composeArgs(stack, "exec", p.service, p.shell), stack.dir, GEOMETRY.exec)
        registry.join(conn, name)
        return { terminal: name }

method "terminal.main" (auth, routable):
    handle(conn):
        if not config.enableConsole: throw AppError("validation", ..., "consoleDisabled")
        shell := existsSync("/bin/bash") ? "bash" : "sh"
        name := hostShellName(conn.id)
        getOrCreate(name, "host", shell, [], config.stacksDir, GEOMETRY.host)
        registry.join(conn, name)
        return { terminal: name }

method "terminal.mainEnabled" (auth, routable):
    handle: return { enabled: config.enableConsole }
```

`terminal.exec` depends on phase 5's stack resolution. Until phase 5 lands, register it behind a
`services.stacks` presence check so the module wiring is complete and the test uses a stub.

## Step 6: Wiring

```
buildServices additions:
    services.terminals := createTerminalRegistry(ws)
    services.onConnClosed := conn => services.terminals.detachConnection(conn)
    services.shutdownHooks.push(() => services.terminals.closeAll())
        # order: after WS closeAll, before db close (phase 1's hook list is FIFO)
```

## Tests (`tests/terminal/`)

Use `/bin/sh -c` scripts as the spawned processes; no Docker needed.

```
- run(): resolves with the exit code; output lands in the buffer; terminalWrite reaches a joined conn
- run() with all subscribers gone: still resolves; finish deletes the name; rerun with same name works
- join before creation -> empty buffer; join after output -> full scrollback replayed
- scrollback caps: a process printing 1 MiB leaves <= 256 KiB in the buffer
- leave on exec closes the pty (assert child gone); detach does NOT close it
- idle sweeper: follow reaped after 60 s idle, exec after 120 s (shrink timers via test hook)
- input to a follow terminal -> terminalNotInteractive
- input from a non-subscriber conn -> terminalNotJoined
- resize clamping: (1, 9999) becomes (20, 200)
- closeTerminal escalation: a child that traps SIGINT and SIGTERM still dies (SIGKILL)
- spawn of a missing binary -> commandFailed + synthetic terminalExit 127
- shutdown: closeAll leaves zero children (poll /proc or child.pid liveness)
```

## Done checklist

- [ ] `pnpm verify` green including the escalation test.
- [ ] No pty survives `stop()`; verified by the shutdown test.
- [ ] `terminal.exec` and `terminal.main` unreachable without auth (router-level, but assert once).
- [ ] Host shell absent from `terminal.mainEnabled` when `--enable-console` is off.
