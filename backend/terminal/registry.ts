import { AppError } from "../../common/errors.ts";
import type { Geometry, TerminalKind } from "../../common/terminal.ts";
import { log } from "../log.ts";
import type { Conn } from "../ws/conn.ts";
import type { WsLayer } from "../ws/server.ts";
import { closeTerminal, spawnTerminal, type TerminalState } from "./terminal.ts";

const IDLE_SWEEP_INTERVAL_MS = 30_000;
const FOLLOW_IDLE_MS = 60_000;
const EXEC_HOST_IDLE_MS = 120_000;
const SHUTDOWN_DEADLINE_MS = 6000;

export interface JoinResult {
    buffer: string;
    exited: boolean;
    exitCode: number | null;
}

export interface TerminalRegistry {
    run(
        name: string,
        file: string,
        args: string[],
        cwd: string,
        joinFor: Conn | null,
        geometry?: Geometry,
    ): Promise<number>;
    has(name: string): boolean;
    getOrCreate(
        name: string,
        kind: TerminalKind,
        file: string,
        args: string[],
        cwd: string,
        geometry: Geometry,
    ): TerminalState;
    join(conn: Conn, name: string): JoinResult;
    leave(conn: Conn, name: string): void;
    input(conn: Conn, name: string, data: string): void;
    resize(conn: Conn, name: string, cols: number, rows: number): void;
    detachConnection(conn: Conn): void;
    closeAll(): Promise<void>;
    /** Tell one connection a just-attempted spawn failed, as a synthetic exit 127. */
    notifySpawnFailure(conn: Conn, name: string): void;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export interface TerminalRegistryOptions {
    /** Overrides for tests; production uses the module constants. */
    idleSweepIntervalMs?: number;
    followIdleMs?: number;
    execHostIdleMs?: number;
}

/** Owns every named pseudo-terminal for the process: creation, join, leave, and idle reaping. */
export function createTerminalRegistry(
    ws: WsLayer,
    options: TerminalRegistryOptions = {},
): TerminalRegistry {
    const registry = new Map<string, TerminalState>();
    const pendingRuns = new Map<string, { resolve: (exitCode: number) => void }>();
    const followIdleMs = options.followIdleMs ?? FOLLOW_IDLE_MS;
    const execHostIdleMs = options.execHostIdleMs ?? EXEC_HOST_IDLE_MS;

    function onData(state: TerminalState, chunk: string): void {
        for (const conn of state.subscribers) {
            const endpoint = conn.endpoint === "" ? "" : conn.endpoint;
            ws.sendEvent(conn, endpoint, "terminalWrite", { terminal: state.name, data: chunk });
        }
    }

    function finish(state: TerminalState, exitCode: number): void {
        state.exited = true;
        state.exitCode = exitCode;
        for (const conn of state.subscribers) {
            ws.sendEvent(conn, conn.endpoint, "terminalExit", { terminal: state.name, exitCode });
        }
        registry.delete(state.name);
        const pending = pendingRuns.get(state.name);
        if (pending !== undefined) {
            pending.resolve(exitCode);
            pendingRuns.delete(state.name);
        }
    }

    function getOrCreate(
        name: string,
        kind: TerminalKind,
        file: string,
        args: string[],
        cwd: string,
        geometry: Geometry,
    ): TerminalState {
        const existing = registry.get(name);
        if (existing !== undefined && !existing.exited) return existing;

        // A spawn failure (missing binary) throws here; the registry never holds a half-made
        // entry. The caller maps it to commandFailed and, when it already joined a connection
        // to this name, sends a synthetic exit so a mounted pane still learns the outcome.
        const state = spawnTerminal(name, kind, file, args, cwd, geometry, onData, finish);
        registry.set(name, state);
        return state;
    }

    /** Notify one connection of a spawn failure as if the terminal had run and exited 127. */
    function notifySpawnFailure(conn: Conn, name: string): void {
        ws.sendEvent(conn, conn.endpoint, "terminalExit", { terminal: name, exitCode: 127 });
    }

    function run(
        name: string,
        file: string,
        args: string[],
        cwd: string,
        joinFor: Conn | null,
        geometry: Geometry = { cols: 105, rows: 8 },
    ): Promise<number> {
        if (registry.has(name)) {
            throw new AppError("conflict", `terminal ${name} is already running`, "terminalBusy");
        }
        try {
            getOrCreate(name, "command", file, args, cwd, geometry);
        } catch (error) {
            if (joinFor !== null) notifySpawnFailure(joinFor, name);
            throw error;
        }
        if (joinFor !== null) join(joinFor, name);
        return new Promise((resolve) => {
            pendingRuns.set(name, { resolve });
        });
    }

    function join(conn: Conn, name: string): JoinResult {
        const state = registry.get(name);
        if (state === undefined) return { buffer: "", exited: false, exitCode: null };
        state.subscribers.add(conn);
        conn.joinedTerminals.add(name);
        state.idleSince = null;
        return { buffer: state.buffer.join(), exited: state.exited, exitCode: state.exitCode };
    }

    function leave(conn: Conn, name: string): void {
        const state = registry.get(name);
        if (state === undefined) return;
        state.subscribers.delete(conn);
        conn.joinedTerminals.delete(name);
        if (state.subscribers.size === 0) {
            state.idleSince = Date.now();
            if (state.kind === "exec" || state.kind === "host") closeTerminal(state);
        }
    }

    function detachConnection(conn: Conn): void {
        for (const name of conn.joinedTerminals) {
            conn.joinedTerminals.delete(name);
            const state = registry.get(name);
            if (state === undefined) continue;
            state.subscribers.delete(conn);
            if (state.subscribers.size === 0) state.idleSince = Date.now();
        }
    }

    function input(conn: Conn, name: string, data: string): void {
        const state = registry.get(name);
        if (state === undefined) {
            throw new AppError("notFound", `no terminal named ${name}`, "terminalNotFound");
        }
        if (state.kind === "command" || state.kind === "follow") {
            throw new AppError(
                "validation",
                `${name} does not accept input`,
                "terminalNotInteractive",
            );
        }
        if (!state.subscribers.has(conn)) {
            throw new AppError("unauthorized", `not joined to ${name}`, "terminalNotJoined");
        }
        state.pty.write(data);
    }

    function resize(conn: Conn, name: string, cols: number, rows: number): void {
        const state = registry.get(name);
        if (state === undefined) return;
        if (!state.subscribers.has(conn)) {
            throw new AppError("unauthorized", `not joined to ${name}`, "terminalNotJoined");
        }
        const clampedCols = clamp(Math.trunc(cols), 20, 500);
        const clampedRows = clamp(Math.trunc(rows), 5, 200);
        state.cols = clampedCols;
        state.rows = clampedRows;
        state.pty.resize(clampedCols, clampedRows);
    }

    const sweepTimer = setInterval(() => {
        const now = Date.now();
        for (const state of registry.values()) {
            if (state.subscribers.size > 0 || state.idleSince === null) continue;
            const idle = now - state.idleSince;
            if (state.kind === "follow" && idle > followIdleMs) closeTerminal(state);
            if ((state.kind === "exec" || state.kind === "host") && idle > execHostIdleMs) {
                closeTerminal(state);
            }
        }
    }, options.idleSweepIntervalMs ?? IDLE_SWEEP_INTERVAL_MS);
    sweepTimer.unref();

    async function closeAll(): Promise<void> {
        clearInterval(sweepTimer);
        for (const state of registry.values()) closeTerminal(state);
        const deadline = Date.now() + SHUTDOWN_DEADLINE_MS;
        while (registry.size > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (registry.size > 0) {
            log.warn("terminal", `${registry.size} terminal(s) still open at the shutdown deadline`);
        }
    }

    return {
        run,
        has: (name) => registry.has(name),
        getOrCreate,
        join,
        leave,
        input,
        resize,
        detachConnection,
        closeAll,
        notifySpawnFailure,
    };
}
