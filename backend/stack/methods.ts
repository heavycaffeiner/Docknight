import { rm } from "node:fs/promises";
import { commandFailed, notFound } from "../../common/errors.ts";
import { RUNNING, type DockerStat, type ServiceInstance, type StackSummary } from "../../common/stack.ts";
import { COMMAND_GEOMETRY, FOLLOW_GEOMETRY, commandTerminalName, followTerminalName } from "../../common/terminal.ts";
import { asObject, bool, noParams, str } from "../../common/validate.ts";
import type { Config } from "../config.ts";
import { log } from "../log.ts";
import * as settings from "../settings.ts";
import * as terminals from "../terminal/registry.ts";
import type { Conn } from "../ws/conn.ts";
import { method } from "../ws/router.ts";
import {
    PLAIN_PROGRESS,
    SHORT_TIMEOUT_MS,
    STATS_TIMEOUT_MS,
    composeArgs,
    parseJsonRecords,
    runCapture,
    runCaptureOk,
} from "./compose.ts";
import { withStackLock } from "./lock.ts";
import * as registry from "./registry.ts";
import {
    assertRemovableDirectory,
    locate,
    read,
    resolveStackPath,
    validateCompose,
    validateEnv,
    write,
    type Stack,
} from "./stack.ts";

interface ComposePsRecord {
    Service?: string;
    Name?: string;
    State?: string;
    Health?: string;
}

/**
 * Attach the stack's combined follow-log terminal for this connection. Created lazily, because a
 * stack that nobody is looking at should not hold a `logs -f` child.
 */
async function joinFollowLog(config: Readonly<Config>, conn: Conn, stack: Stack): Promise<void> {
    const name = followTerminalName(conn.endpoint, stack.name);
    const args = await composeArgs(config, stack, "logs", ["--follow", "--tail", "200"]);
    try {
        terminals.getOrCreate(name, "follow", "docker", args, stack.dir, FOLLOW_GEOMETRY);
    } catch (error) {
        // A missing docker binary must not stop the stack page from rendering.
        log.warn("stacks", `cannot start the follow log for ${stack.name}`, error);
        return;
    }
    terminals.join(conn, name);
}

/**
 * Run one long compose command in the stack's progress terminal. The terminal name is derived
 * from the endpoint and the stack name, so a client that reconnects mid-deploy re-joins it and
 * sees the scrollback rather than a blank pane.
 */
async function runComposeCommand(
    config: Readonly<Config>,
    conn: Conn,
    stack: Stack,
    command: string,
    extra: string[],
): Promise<number> {
    const terminalName = commandTerminalName(conn.endpoint, stack.name);
    const args = await composeArgs(config, stack, command, extra, PLAIN_PROGRESS);
    try {
        const exitCode = await terminals.run(
            terminalName,
            "docker",
            args,
            stack.dir,
            conn,
            COMMAND_GEOMETRY,
        );
        if (exitCode !== 0) {
            throw commandFailed(`docker compose ${command} exited ${exitCode}`, {
                i18n: "composeCommandFailed",
                values: { code: exitCode, terminal: terminalName },
            });
        }
        return exitCode;
    } finally {
        // Emitted even on failure: compose may have partly succeeded and the UI must show the
        // real state rather than the state it hoped for.
        await registry.refreshAndEmit().catch((error: unknown) => {
            log.warn("stacks", "post-command refresh failed", error);
        });
    }
}

function lifecycle(
    config: Readonly<Config>,
    name: "stack.start" | "stack.stop" | "stack.restart" | "stack.down",
    command: string,
    extra: string[],
): void {
    method<{ name: string }, { exitCode: number }>(name, {
        requiresAuth: true,
        routable: true,
        parse: (raw) => ({ name: str(asObject(raw), "name") }),
        handle: async (conn, params) => {
            const stack = await locate(config, params.name);
            const exitCode = await withStackLock(params.name, () =>
                runComposeCommand(config, conn, stack, command, extra),
            );
            if (name === "stack.start") await joinFollowLog(config, conn, stack);
            if (name === "stack.stop") {
                // A stopped stack produces no further output.
                terminals.leave(conn, followTerminalName(conn.endpoint, stack.name));
            }
            return { exitCode };
        },
    });
}

function serviceMethod(
    config: Readonly<Config>,
    name: "service.start" | "service.stop" | "service.restart",
    command: string,
    extraBefore: string[],
): void {
    method<{ stack: string; service: string }, { exitCode: number }>(name, {
        requiresAuth: true,
        routable: true,
        parse: (raw) => {
            const object = asObject(raw);
            return {
                stack: str(object, "stack"),
                service: str(object, "service", { min: 1, max: 128, pattern: /^[A-Za-z0-9._-]+$/ }),
            };
        },
        handle: async (conn, params) => {
            const stack = await locate(config, params.stack);
            const exitCode = await withStackLock(params.stack, () =>
                runComposeCommand(config, conn, stack, command, [...extraBefore, params.service]),
            );
            return { exitCode };
        },
    });
}

export function registerStackMethods(config: Readonly<Config>): void {
    method<undefined, { stacks: Record<string, StackSummary> }>("stack.list", {
        requiresAuth: true,
        routable: true,
        parse: noParams,
        handle: async () => {
            await registry.refresh();
            return { stacks: registry.snapshot() };
        },
    });

    method("stack.get", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => ({ name: str(asObject(raw), "name") }),
        handle: async (conn, params) => {
            const summaries = registry.snapshot();
            const summary = summaries[params.name];
            if (summary !== undefined && !summary.managed) {
                throw notFound(`stack ${params.name} has no directory`, {
                    i18n: "stackNotFound",
                    values: { name: params.name },
                });
            }
            const detail = await read(
                config,
                params.name,
                settings.generalSettings().primaryHostname,
                summary?.status,
            );
            const stack = await locate(config, params.name);
            await joinFollowLog(config, conn, stack);
            return { stack: detail };
        },
    });

    method("stack.save", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => {
            const object = asObject(raw);
            return {
                name: str(object, "name"),
                composeYAML: str(object, "composeYAML", { max: 1024 * 1024 }),
                composeENV: str(object, "composeENV", { max: 1024 * 1024 }),
                isCreate: bool(object, "isCreate"),
            };
        },
        handle: async (_conn, params) => {
            validateCompose(params.composeYAML);
            validateEnv(params.composeENV, ".env");
            await write(config, params.name, params.composeYAML, params.composeENV, params.isCreate);
            await registry.refreshAndEmit();
            return { ok: true as const };
        },
    });

    method("stack.deploy", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => {
            const object = asObject(raw);
            return {
                name: str(object, "name"),
                composeYAML: str(object, "composeYAML", { max: 1024 * 1024 }),
                composeENV: str(object, "composeENV", { max: 1024 * 1024 }),
                isCreate: bool(object, "isCreate"),
            };
        },
        handle: async (conn, params) => {
            validateCompose(params.composeYAML);
            validateEnv(params.composeENV, ".env");
            const exitCode = await withStackLock(params.name, async () => {
                const { stack } = await write(
                    config,
                    params.name,
                    params.composeYAML,
                    params.composeENV,
                    params.isCreate,
                );
                return runComposeCommand(config, conn, stack, "up", ["-d", "--remove-orphans"]);
            });
            const stack = await locate(config, params.name);
            await joinFollowLog(config, conn, stack);
            return { exitCode };
        },
    });

    lifecycle(config, "stack.start", "up", ["-d", "--remove-orphans"]);
    lifecycle(config, "stack.stop", "stop", []);
    lifecycle(config, "stack.restart", "restart", []);
    lifecycle(config, "stack.down", "down", []);

    method("stack.update", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => ({ name: str(asObject(raw), "name") }),
        handle: async (conn, params) => {
            const stack = await locate(config, params.name);
            const exitCode = await withStackLock(params.name, async () => {
                const pullCode = await runComposeCommand(config, conn, stack, "pull", []);
                // Pulling images for a stopped stack must not start it.
                await registry.refresh();
                if (registry.snapshot()[params.name]?.status !== RUNNING) return pullCode;
                return runComposeCommand(config, conn, stack, "up", ["-d", "--remove-orphans"]);
            });
            return { exitCode };
        },
    });

    method("stack.delete", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => ({ name: str(asObject(raw), "name") }),
        handle: async (conn, params) => {
            const stack = await locate(config, params.name);
            const exitCode = await withStackLock(params.name, async () => {
                // The directory is removed only after down returns zero.
                const code = await runComposeCommand(config, conn, stack, "down", ["--remove-orphans"]);
                const target = resolveStackPath(config.stacksDir, params.name);
                await assertRemovableDirectory(target);
                await rm(target, { recursive: true, force: true });
                log.info("stacks", `removed ${target}`);
                return code;
            });
            await registry.refreshAndEmit();
            return { exitCode };
        },
    });

    method("stack.serviceStatus", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => ({ name: str(asObject(raw), "name") }),
        handle: async (_conn, params) => {
            const stack = await locate(config, params.name);
            const args = await composeArgs(config, stack, "ps", ["--format", "json", "--all"]);
            const result = await runCapture(args, stack.dir, SHORT_TIMEOUT_MS).catch(
                (error: unknown) => {
                    log.warn("stacks", `compose ps for ${params.name} failed`, error);
                    return null;
                },
            );
            const services: Record<string, ServiceInstance[]> = {};
            if (result === null || result.code !== 0) return { services };

            for (const record of parseJsonRecords<ComposePsRecord>(result.stdout)) {
                const service = record.Service;
                if (typeof service !== "string" || service === "") continue;
                // Health takes precedence over State, which is the distinction the UI colours on.
                const status = record.Health !== undefined && record.Health !== ""
                    ? record.Health
                    : (record.State ?? "unknown");
                const list = services[service] ?? [];
                list.push({ name: record.Name ?? service, status });
                services[service] = list;
            }
            return { services };
        },
    });

    serviceMethod(config, "service.start", "up", ["-d"]);
    serviceMethod(config, "service.stop", "stop", []);
    serviceMethod(config, "service.restart", "restart", []);

    method("docker.stats", {
        requiresAuth: true,
        routable: true,
        parse: noParams,
        handle: async () => {
            // Host-wide, because one invocation covers every stack page a user might have open.
            const result = await runCapture(
                ["stats", "--format", "json", "--no-stream"],
                config.stacksDir,
                STATS_TIMEOUT_MS,
            ).catch((error: unknown) => {
                log.warn("stacks", "docker stats failed", error);
                return null;
            });
            const stats: Record<string, DockerStat> = {};
            if (result === null || result.code !== 0) return { stats };
            for (const record of parseJsonRecords<DockerStat>(result.stdout)) {
                if (typeof record.Name === "string" && record.Name !== "") stats[record.Name] = record;
            }
            return { stats };
        },
    });

    method("docker.networks", {
        requiresAuth: true,
        routable: true,
        parse: noParams,
        handle: async () => {
            const out = await runCaptureOk(
                ["network", "ls", "--format", "{{.Name}}"],
                config.stacksDir,
                SHORT_TIMEOUT_MS,
            ).catch((error: unknown) => {
                log.warn("stacks", "docker network ls failed", error);
                return "";
            });
            const networks = out
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line !== "")
                .sort((a, b) => a.localeCompare(b));
            return { networks };
        },
    });
}
