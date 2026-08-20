import { existsSync } from "node:fs";
import { AppError } from "../../common/errors.ts";
import { noParams, num, obj, str } from "../../common/validate.ts";
import { execTerminalName, GEOMETRY, hostShellName } from "../../common/terminal.ts";
import type { Config } from "../config.ts";
import type { Conn } from "../ws/conn.ts";
import { method } from "../ws/router.ts";
import type { TerminalRegistry } from "./registry.ts";

declare module "../../common/protocol.ts" {
    interface MethodMap {
        "terminal.join": {
            params: { terminal: string };
            result: { buffer: string; exited: boolean; exitCode: number | null };
        };
        "terminal.leave": { params: { terminal: string }; result: { ok: true } };
        "terminal.input": { params: { terminal: string; data: string }; result: { ok: true } };
        "terminal.resize": {
            params: { terminal: string; cols: number; rows: number };
            result: { ok: true };
        };
        "terminal.exec": {
            params: { stack: string; service: string; shell: string };
            result: { terminal: string };
        };
        "terminal.main": { params: undefined; result: { terminal: string } };
        "terminal.mainEnabled": { params: undefined; result: { enabled: boolean } };
    }

    interface EventMap {
        terminalWrite: { terminal: string; data: string };
        terminalExit: { terminal: string; exitCode: number };
    }
}

const SHELLS = new Set(["sh", "bash", "ash", "zsh"]);

/**
 * The subset of the stack layer `terminal.exec` needs. Proposal 3 (phase 5) supplies the real
 * implementation; until then `registerTerminalMethods` is called with this absent, and
 * `terminal.exec` reports `commandFailed`.
 */
export interface StackResolver {
    resolveForExec(name: string): { dir: string; serviceNames: string[] };
    composeExecArgs(stackDir: string, service: string, shell: string): string[];
}

const joinParse = obj({ terminal: str({ max: 256 }) });
const leaveParse = obj({ terminal: str({ max: 256 }) });
const inputParse = obj({ terminal: str({ max: 256 }), data: str({ max: 65536 }) });
const resizeParse = obj({
    terminal: str({ max: 256 }),
    cols: num({ int: true }),
    rows: num({ int: true }),
});
const execParse = obj({
    stack: str({ max: 128 }),
    service: str({ max: 128 }),
    shell: str({ max: 16 }),
});

export function registerTerminalMethods(
    registry: TerminalRegistry,
    config: Readonly<Config>,
    stacks: StackResolver | null,
): void {
    method("terminal.join", {
        requiresAuth: true,
        routable: true,
        parse: joinParse,
        handle: (conn: Conn, params) => registry.join(conn, params.terminal),
    });

    method("terminal.leave", {
        requiresAuth: true,
        routable: true,
        parse: leaveParse,
        handle: (conn: Conn, params) => {
            registry.leave(conn, params.terminal);
            return { ok: true as const };
        },
    });

    method("terminal.input", {
        requiresAuth: true,
        routable: true,
        parse: inputParse,
        handle: (conn: Conn, params) => {
            registry.input(conn, params.terminal, params.data);
            return { ok: true as const };
        },
    });

    method("terminal.resize", {
        requiresAuth: true,
        routable: true,
        parse: resizeParse,
        handle: (conn: Conn, params) => {
            registry.resize(conn, params.terminal, params.cols, params.rows);
            return { ok: true as const };
        },
    });

    method("terminal.exec", {
        requiresAuth: true,
        routable: true,
        parse: execParse,
        handle: (conn: Conn, params) => {
            if (!SHELLS.has(params.shell)) {
                throw new AppError("validation", `${params.shell} is not a supported shell`, "unsupportedShell");
            }
            if (stacks === null) {
                throw new AppError("commandFailed", "the stack layer is not available", "dockerUnavailable");
            }
            const stack = stacks.resolveForExec(params.stack);
            if (!stack.serviceNames.includes(params.service)) {
                throw new AppError("notFound", `no service named ${params.service}`, "serviceNotFound");
            }
            const name = execTerminalName(conn.endpoint, params.stack, params.service, conn.id);
            const args = stacks.composeExecArgs(stack.dir, params.service, params.shell);
            try {
                registry.getOrCreate(name, "exec", "docker", args, stack.dir, GEOMETRY.exec);
            } catch (error) {
                registry.notifySpawnFailure(conn, name);
                throw error;
            }
            registry.join(conn, name);
            return { terminal: name };
        },
    });

    method("terminal.main", {
        requiresAuth: true,
        routable: true,
        parse: noParams(),
        handle: (conn: Conn) => {
            if (!config.enableConsole) {
                throw new AppError("validation", "the host console is disabled", "consoleDisabled");
            }
            const shell = existsSync("/bin/bash") ? "bash" : "sh";
            const name = hostShellName(conn.id);
            try {
                registry.getOrCreate(name, "host", shell, [], config.stacksDir, GEOMETRY.host);
            } catch (error) {
                registry.notifySpawnFailure(conn, name);
                throw error;
            }
            registry.join(conn, name);
            return { terminal: name };
        },
    });

    method("terminal.mainEnabled", {
        requiresAuth: true,
        routable: true,
        parse: noParams(),
        handle: () => ({ enabled: config.enableConsole }),
    });
}
