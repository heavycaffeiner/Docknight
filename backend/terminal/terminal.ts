import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { spawn as spawnPty, type IPty } from "@homebridge/node-pty-prebuilt-multiarch";
import type { Geometry, TerminalKind } from "../../common/terminal.ts";
import { AppError } from "../../common/errors.ts";
import type { Conn } from "../ws/conn.ts";
import { RingBuffer } from "./ring-buffer.ts";

export interface TerminalState {
    name: string;
    kind: TerminalKind;
    pty: IPty;
    cols: number;
    rows: number;
    buffer: RingBuffer;
    subscribers: Set<Conn>;
    exited: boolean;
    exitCode: number | null;
    idleSince: number | null;
}

/**
 * Resolve `file` against PATH the same way a shell would, so a missing binary fails before a
 * pty is forked rather than surfacing only through the child's own exec failure, which some
 * platforms report asynchronously and inconsistently.
 */
function resolveExecutable(file: string): string | null {
    if (file.includes("/")) {
        try {
            accessSync(file, constants.X_OK);
            return file;
        } catch {
            return null;
        }
    }
    const dirs = (process.env.PATH ?? "").split(delimiter);
    for (const dir of dirs) {
        if (dir === "") continue;
        const candidate = join(dir, file);
        try {
            accessSync(candidate, constants.X_OK);
            return candidate;
        } catch {
            continue;
        }
    }
    return null;
}

/**
 * Spawn one pty and wire its data and exit fan-out. `onData` and `onExit` are called for every
 * chunk and on process exit; the caller owns subscriber notification.
 *
 * @throws AppError("commandFailed", ..., "terminalSpawnFailed") when `file` cannot be resolved
 *         on PATH, before any process is forked.
 */
export function spawnTerminal(
    name: string,
    kind: TerminalKind,
    file: string,
    args: string[],
    cwd: string,
    geometry: Geometry,
    onData: (state: TerminalState, chunk: string) => void,
    onExit: (state: TerminalState, exitCode: number) => void,
): TerminalState {
    if (resolveExecutable(file) === null) {
        throw new AppError(
            "commandFailed",
            `cannot spawn ${name}: ${file} not found on PATH`,
            "terminalSpawnFailed",
        );
    }

    const pty = spawnPty(file, args, {
        name: "xterm-256color",
        cwd,
        env: process.env as Record<string, string>,
        cols: geometry.cols,
        rows: geometry.rows,
    });

    const state: TerminalState = {
        name,
        kind,
        pty,
        cols: geometry.cols,
        rows: geometry.rows,
        buffer: new RingBuffer(200, 256 * 1024),
        subscribers: new Set(),
        exited: false,
        exitCode: null,
        idleSince: null,
    };

    pty.onData((chunk) => {
        state.buffer.push(chunk);
        onData(state, chunk);
    });
    pty.onExit(({ exitCode }) => {
        onExit(state, exitCode);
    });

    return state;
}

/** Ctrl-C, then SIGTERM after 2 s, then SIGKILL after 5 s. Safe to call on an exited terminal. */
export function closeTerminal(state: TerminalState): void {
    if (state.exited) return;
    try {
        state.pty.write("\x03");
    } catch {
        // The pty may already be gone; the escalation timers below still run as a backstop.
    }

    const termTimer = setTimeout(() => {
        try {
            state.pty.kill("SIGTERM");
        } catch {
            // Already gone.
        }
    }, 2000);
    termTimer.unref();

    const killTimer = setTimeout(() => {
        try {
            state.pty.kill("SIGKILL");
        } catch {
            // Already gone.
        }
    }, 5000);
    killTimer.unref();

    // Cancel both once the process actually exits, so a program that honours Ctrl-C promptly
    // never has a stray SIGTERM or SIGKILL delivered to a reused pid.
    const disposable = state.pty.onExit(() => {
        clearTimeout(termTimer);
        clearTimeout(killTimer);
        disposable.dispose();
    });
}
