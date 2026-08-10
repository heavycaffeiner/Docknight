import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import { RequestError, commandFailed, conflict } from "../../common/errors.ts";
import {
    clampCols,
    clampRows,
    type Geometry,
    type TerminalKind,
} from "../../common/terminal.ts";
import { log } from "../log.ts";
import type { Conn } from "../ws/conn.ts";
import { emitTo, queueTerminalWrite } from "../ws/hub.ts";
import { RingBuffer } from "./ring-buffer.ts";

const BUFFER_CHUNKS = 200;
const BUFFER_BYTES = 256 * 1024;

const FOLLOW_IDLE_MS = 60_000;
const SWEEP_INTERVAL_MS = 30_000;

/**
 * How long a private shell outlives the socket that was watching it. A mobile browser drops the
 * socket whenever the user switches apps, and killing the shell there loses the work they are
 * coming back to.
 */
const DETACH_GRACE_MS = 120_000;

const INTERRUPT_DELAY_MS = 2_000;
const TERM_DELAY_MS = 5_000;

export interface TerminalState {
    name: string;
    kind: TerminalKind;
    pty: pty.IPty;
    cols: number;
    rows: number;
    buffer: RingBuffer;
    subscribers: Set<Conn>;
    exited: boolean;
    exitCode: number | null;
    /** Set when subscribers becomes empty; read by the idle sweeper. */
    idleSince: number | null;
    /** Resolvers for run() promises awaiting this terminal's exit. */
    waiters: ((exitCode: number) => void)[];
    timers: NodeJS.Timeout[];
}

const registry = new Map<string, TerminalState>();
let sweeper: NodeJS.Timeout | null = null;

export function get(name: string): TerminalState | undefined {
    return registry.get(name);
}

export function has(name: string): boolean {
    const state = registry.get(name);
    return state !== undefined && !state.exited;
}

export function size(): number {
    return registry.size;
}

/** Create the terminal if absent, otherwise return the live one. Never restarts a running pty. */
export function getOrCreate(
    name: string,
    kind: TerminalKind,
    file: string,
    args: string[],
    cwd: string,
    geometry: Geometry,
): TerminalState {
    const existing = registry.get(name);
    if (existing !== undefined && !existing.exited) return existing;

    let child: pty.IPty;
    try {
        child = pty.spawn(file, args, {
            name: "xterm-256color",
            cwd,
            env: process.env as Record<string, string>,
            cols: geometry.cols,
            rows: geometry.rows,
        });
    } catch (error) {
        log.error("terminal", `spawn ${file} failed`, error);
        throw commandFailed(`cannot start ${file}`, {
            i18n: "terminalSpawnFailed",
            values: { file },
            cause: error,
        });
    }

    const state: TerminalState = {
        name,
        kind,
        pty: child,
        cols: geometry.cols,
        rows: geometry.rows,
        buffer: new RingBuffer(BUFFER_CHUNKS, BUFFER_BYTES),
        subscribers: new Set(),
        exited: false,
        exitCode: null,
        idleSince: Date.now(),
        waiters: [],
        timers: [],
    };
    registry.set(name, state);
    log.debug("terminal", `${name} started ${file} ${args.join(" ")}`);

    child.onData((chunk: string) => {
        state.buffer.push(chunk);
        for (const conn of state.subscribers) {
            queueTerminalWrite(conn, conn.endpoint, name, chunk);
        }
    });

    child.onExit(({ exitCode }: { exitCode: number }) => finish(state, exitCode));

    return state;
}

function finish(state: TerminalState, exitCode: number): void {
    if (state.exited) return;
    state.exited = true;
    state.exitCode = exitCode;
    for (const timer of state.timers) clearTimeout(timer);
    state.timers = [];

    for (const conn of state.subscribers) {
        emitTo(conn, "terminalExit", conn.endpoint, { terminal: state.name, exitCode });
        conn.joinedTerminals.delete(state.name);
    }
    state.subscribers.clear();

    // Deleting on exit is what makes the command terminal name a usable single-flight key.
    if (registry.get(state.name) === state) registry.delete(state.name);

    const waiters = state.waiters;
    state.waiters = [];
    for (const resolve of waiters) resolve(exitCode);

    log.debug("terminal", `${state.name} exited with ${exitCode}`);
}

/**
 * Subscribe to a terminal and receive its scrollback. Joining a terminal that does not exist is
 * not an error; the client mounts its pane before the command that creates the terminal runs.
 */
export function join(
    conn: Conn,
    name: string,
): { buffer: string; exited: boolean; exitCode: number | null } {
    const state = registry.get(name);
    if (state === undefined) return { buffer: "", exited: false, exitCode: null };
    state.subscribers.add(conn);
    conn.joinedTerminals.add(name);
    state.idleSince = null;
    return { buffer: state.buffer.join(), exited: state.exited, exitCode: state.exitCode };
}

export function leave(conn: Conn, name: string): void {
    conn.joinedTerminals.delete(name);
    const state = registry.get(name);
    if (state === undefined) return;
    state.subscribers.delete(conn);
    if (state.subscribers.size > 0) return;

    state.idleSince = Date.now();
    // A private shell dies with its viewer. "follow" is reaped by the sweeper and "command"
    // runs to completion regardless.
    if (state.kind === "exec" || state.kind === "host") closeTerminal(state);
}

/**
 * Remove `conn` from every terminal it joined, closing none of them. Called from the socket close
 * handler, where the viewer has not decided to leave: the socket died under it and may come back
 * with a rejoin. A shell nobody returns to is reaped by the sweeper.
 */
export function detachConnection(conn: Conn): void {
    for (const name of [...conn.joinedTerminals]) {
        conn.joinedTerminals.delete(name);
        const state = registry.get(name);
        if (state === undefined) continue;
        state.subscribers.delete(conn);
        if (state.subscribers.size === 0) state.idleSince = Date.now();
    }
}

/** Ctrl-C, then SIGTERM after 2 s, then SIGKILL after 5 s. Safe on an exited terminal. */
export function closeTerminal(state: TerminalState): void {
    if (state.exited) return;
    try {
        state.pty.write("\x03");
    } catch {
        // Already gone; the escalation below still runs and is harmless.
    }

    const term = setTimeout(() => {
        if (state.exited) return;
        try {
            state.pty.kill("SIGTERM");
        } catch {
            // Nothing left to signal.
        }
    }, INTERRUPT_DELAY_MS);

    const kill = setTimeout(() => {
        if (state.exited) return;
        try {
            state.pty.kill("SIGKILL");
        } catch {
            // Nothing left to signal.
        }
    }, TERM_DELAY_MS);

    term.unref();
    kill.unref();
    state.timers.push(term, kill);
}

/**
 * Start a one-shot command in a named terminal and resolve with its exit code. The command runs
 * to completion even if every subscriber leaves.
 *
 * @throws RequestError("conflict", "terminalBusy") when the name is already live.
 */
export function run(
    name: string,
    file: string,
    args: string[],
    cwd: string,
    joinFor: Conn | null,
    geometry: Geometry,
): Promise<number> {
    if (has(name)) {
        throw conflict(`terminal ${name} is already running`, { i18n: "terminalBusy" });
    }

    let state: TerminalState;
    try {
        state = getOrCreate(name, "command", file, args, cwd, geometry);
    } catch (error) {
        // A spawn failure is reported as an exit event too, so a client that already mounted its
        // pane sees the outcome in place.
        if (joinFor !== null) {
            emitTo(joinFor, "terminalExit", joinFor.endpoint, { terminal: name, exitCode: 127 });
        }
        throw error;
    }

    if (joinFor !== null) join(joinFor, name);
    if (state.exited) return Promise.resolve(state.exitCode ?? 0);
    return new Promise<number>((resolve) => state.waiters.push(resolve));
}

export function input(conn: Conn, name: string, data: string): void {
    const state = registry.get(name);
    if (state === undefined) {
        throw new RequestError("notFound", `no terminal ${name}`, { i18n: "terminalNotFound" });
    }
    if (state.kind === "command" || state.kind === "follow") {
        throw new RequestError("validation", `${name} is not interactive`, {
            i18n: "terminalNotInteractive",
        });
    }
    // Membership is checked because exec names are derived from public stack and service names.
    if (!state.subscribers.has(conn)) {
        throw new RequestError("unauthorized", `not joined to ${name}`, {
            i18n: "terminalNotJoined",
        });
    }
    state.pty.write(data);
}

export function resize(conn: Conn, name: string, cols: number, rows: number): void {
    const state = registry.get(name);
    if (state === undefined) return; // A resize for a finished terminal is not an error.
    if (!state.subscribers.has(conn)) {
        throw new RequestError("unauthorized", `not joined to ${name}`, {
            i18n: "terminalNotJoined",
        });
    }
    const nextCols = clampCols(cols);
    const nextRows = clampRows(rows);
    state.cols = nextCols;
    state.rows = nextRows;
    try {
        state.pty.resize(nextCols, nextRows);
    } catch (error) {
        log.debug("terminal", `${name} resize failed`, error);
    }
}

/** Null for "command", which runs to completion whether or not anyone is watching. */
function idleLimit(kind: TerminalKind): number | null {
    switch (kind) {
        case "follow":
            return FOLLOW_IDLE_MS;
        case "exec":
        case "host":
            return DETACH_GRACE_MS;
        default:
            return null;
    }
}

export function startIdleSweeper(): void {
    if (sweeper !== null) return;
    sweeper = setInterval(() => {
        const now = Date.now();
        for (const state of [...registry.values()]) {
            if (state.subscribers.size > 0) continue;
            const limit = idleLimit(state.kind);
            if (limit === null) continue;
            if (state.idleSince === null || now - state.idleSince < limit) continue;
            log.debug("terminal", `${state.name} idle, closing`);
            closeTerminal(state);
        }
    }, SWEEP_INTERVAL_MS);
    sweeper.unref();
}

export function stopIdleSweeper(): void {
    if (sweeper !== null) clearInterval(sweeper);
    sweeper = null;
}

/** Close every live terminal. Called during shutdown before the database is closed. */
export async function closeAll(): Promise<void> {
    stopIdleSweeper();
    const states = [...registry.values()];
    for (const state of states) closeTerminal(state);

    const pending = states.filter((state) => !state.exited);
    if (pending.length === 0) return;

    await Promise.race([
        Promise.all(
            pending.map(
                (state) =>
                    new Promise<void>((resolve) => {
                        state.waiters.push(() => resolve());
                    }),
            ),
        ),
        new Promise<void>((resolve) => setTimeout(resolve, TERM_DELAY_MS + 1_000).unref()),
    ]);
    registry.clear();
}
