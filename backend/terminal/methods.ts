import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { access, constants } from "node:fs";
import { notFound, validation } from "../../common/errors.ts";
import {
    EXEC_GEOMETRY,
    HOST_GEOMETRY,
    execTerminalName,
    hostTerminalName,
    isAllowedShell,
} from "../../common/terminal.ts";
import { asObject, int, noParams, str } from "../../common/validate.ts";
import type { Config } from "../config.ts";
import { composeArgs } from "../stack/compose.ts";
import { locate, serviceNames } from "../stack/stack.ts";
import { method } from "../ws/router.ts";
import * as terminals from "./registry.ts";

function onPath(file: string): Promise<boolean> {
    return new Promise((resolve) => {
        const paths = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
        let remaining = paths.length;
        if (remaining === 0) {
            resolve(false);
            return;
        }
        let found = false;
        for (const dir of paths) {
            access(join(dir, file), constants.X_OK, (error) => {
                if (!error) found = true;
                remaining -= 1;
                if (remaining === 0) resolve(found);
            });
        }
    });
}

export function registerTerminalMethods(config: Readonly<Config>): void {
    method("terminal.join", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => ({ terminal: str(asObject(raw), "terminal", { min: 1, max: 512 }) }),
        handle: (conn, params) => terminals.join(conn, params.terminal),
    });

    method("terminal.leave", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => ({ terminal: str(asObject(raw), "terminal", { min: 1, max: 512 }) }),
        handle: (conn, params) => {
            terminals.leave(conn, params.terminal);
            return { ok: true as const };
        },
    });

    method("terminal.input", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => {
            const object = asObject(raw);
            return {
                terminal: str(object, "terminal", { min: 1, max: 512 }),
                data: str(object, "data", { max: 64 * 1024 }),
            };
        },
        handle: (conn, params) => {
            terminals.input(conn, params.terminal, params.data);
            return { ok: true as const };
        },
    });

    method("terminal.resize", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => {
            const object = asObject(raw);
            return {
                terminal: str(object, "terminal", { min: 1, max: 512 }),
                cols: int(object, "cols", { min: 1, max: 10_000 }),
                rows: int(object, "rows", { min: 1, max: 10_000 }),
            };
        },
        handle: (conn, params) => {
            terminals.resize(conn, params.terminal, params.cols, params.rows);
            return { ok: true as const };
        },
    });

    method("terminal.exec", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => {
            const object = asObject(raw);
            return {
                stack: str(object, "stack"),
                service: str(object, "service", { min: 1, max: 128, pattern: /^[A-Za-z0-9._-]+$/ }),
                shell: str(object, "shell", { min: 2, max: 8 }),
            };
        },
        handle: async (conn, params) => {
            if (!isAllowedShell(params.shell)) {
                throw validation(`shell ${params.shell} is not supported`, {
                    i18n: "unsupportedShell",
                    values: { shell: params.shell },
                });
            }
            const stack = await locate(config, params.stack);

            // Checked against the stack's own compose file, so a request cannot reach a container
            // outside the addressed stack.
            const composeYAML = await readFile(join(stack.dir, stack.composeFileName), "utf8").catch(
                () => "",
            );
            if (!serviceNames(composeYAML).includes(params.service)) {
                throw notFound(`service ${params.service} is not part of ${params.stack}`, {
                    i18n: "serviceNotFound",
                    values: { service: params.service },
                });
            }

            const name = execTerminalName(conn.endpoint, params.stack, params.service, conn.id);
            const args = await composeArgs(config, stack, "exec", params.service, params.shell);
            terminals.getOrCreate(name, "exec", "docker", args, stack.dir, EXEC_GEOMETRY);
            terminals.join(conn, name);
            return { terminal: name };
        },
    });

    method("terminal.main", {
        requiresAuth: true,
        routable: true,
        parse: noParams,
        handle: async (conn) => {
            if (!config.enableConsole) {
                throw validation("the host console is disabled", { i18n: "consoleDisabled" });
            }
            const shell = (await onPath("bash")) ? "bash" : "sh";
            const name = hostTerminalName(conn.id);
            terminals.getOrCreate(name, "host", shell, [], config.stacksDir, HOST_GEOMETRY);
            terminals.join(conn, name);
            return { terminal: name };
        },
    });

    method("terminal.mainEnabled", {
        requiresAuth: true,
        routable: true,
        parse: noParams,
        handle: () => ({ enabled: config.enableConsole }),
    });
}
