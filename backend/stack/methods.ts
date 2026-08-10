import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
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
    serviceNames,
    validateCompose,
    validateEnv,
    write,
    type Stack,
} from "./stack.ts";

interface ComposePsRecord {
    Service?: string;
    Name?: string;
    Image?: string;
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
 * Run one long docker command in the stack's progress terminal. The terminal name is derived
 * from the endpoint and the stack name, so a client that reconnects mid-deploy re-joins it and
 * sees the scrollback rather than a blank pane.
 */
async function runInProgressTerminal(
    conn: Conn,
    stack: Stack,
    argv: string[],
    label: string,
): Promise<number> {
    const terminalName = commandTerminalName(conn.endpoint, stack.name);
    try {
        const exitCode = await terminals.run(
            terminalName,
            "docker",
            argv,
            stack.dir,
            conn,
            COMMAND_GEOMETRY,
        );
        if (exitCode !== 0) {
            throw commandFailed(`${label} exited ${exitCode}`, {
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

async function runComposeCommand(
    config: Readonly<Config>,
    conn: Conn,
    stack: Stack,
    command: string,
    extra: string[],
): Promise<number> {
    const args = await composeArgs(config, stack, command, extra, PLAIN_PROGRESS);
    return runInProgressTerminal(conn, stack, args, `docker compose ${command}`);
}

/** What docker will accept as a container name. Anything else is not passed to it as an argument. */
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** What docker will accept as an image reference. Same purpose as the container name pattern. */
const IMAGE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/;

interface StackContainer {
    name: string;
    service: string;
    image: string;
    /** False when the compose file no longer declares this container's service. */
    declared: boolean;
}

/**
 * Every container docker files under this project, in the order the compose file declares their
 * services, with anything the file no longer describes last.
 *
 * The container list is what the stack page counts, and it is not the same set as the services in
 * the file. Every compose subcommand resolves its targets from the file, so it acts on the
 * intersection and reports success for the rest: a stack showing three containers restarts one, or
 * none, and exits zero. Acting on the containers instead removes the guesswork.
 */
async function stackContainers(
    config: Readonly<Config>,
    stack: Stack,
): Promise<StackContainer[]> {
    const composeYAML = await readFile(join(stack.dir, stack.composeFileName), "utf8").catch(
        (error: unknown) => {
            log.warn("stacks", `cannot read the compose file for ${stack.name}`, error);
            return "";
        },
    );
    const order = new Map(serviceNames(composeYAML).map((name, index) => [name, index]));

    const psArgs = await composeArgs(config, stack, "ps", ["--format", "json", "--all"]);
    const listed = await runCapture(psArgs, stack.dir, SHORT_TIMEOUT_MS).catch(() => null);
    if (listed === null || listed.code !== 0) return [];

    return parseJsonRecords<ComposePsRecord>(listed.stdout)
        .map((record) => ({
            name: record.Name ?? "",
            service: record.Service ?? "",
            image: record.Image ?? "",
            declared: order.has(record.Service ?? ""),
        }))
        .filter((entry) => CONTAINER_NAME.test(entry.name))
        .sort((left, right) => {
            const byService =
                (order.get(left.service) ?? Number.MAX_SAFE_INTEGER) -
                (order.get(right.service) ?? Number.MAX_SAFE_INTEGER);
            return byService !== 0 ? byService : left.name.localeCompare(right.name);
        });
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
    lifecycle(config, "stack.down", "down", ["--remove-orphans"]);

    method<{ name: string }, { exitCode: number }>("stack.restart", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => ({ name: str(asObject(raw), "name") }),
        handle: async (conn, params) => {
            const stack = await locate(config, params.name);
            const exitCode = await withStackLock(params.name, async () => {
                const containers = await stackContainers(config, stack);
                // Nothing exists to restart, so compose is left to say why in its own words.
                if (containers.length === 0) {
                    return runComposeCommand(config, conn, stack, "restart", []);
                }
                return runInProgressTerminal(
                    conn,
                    stack,
                    ["restart", ...containers.map((entry) => entry.name)],
                    "docker restart",
                );
            });
            return { exitCode };
        },
    });

    method("stack.update", {
        requiresAuth: true,
        routable: true,
        parse: (raw: unknown) => ({ name: str(asObject(raw), "name") }),
        handle: async (conn, params) => {
            const stack = await locate(config, params.name);
            const exitCode = await withStackLock(params.name, async () => {
                const containers = await stackContainers(config, stack);

                // `compose pull` fetches the images of the services the file declares, which is not
                // the same thing as the images this stack is running. Anything left over is named
                // directly so every container's image is fetched, not just the ones still declared.
                const covered = new Set(
                    containers.filter((entry) => entry.declared).map((entry) => entry.image),
                );
                const extra = [
                    ...new Set(
                        containers
                            .filter((entry) => !entry.declared && !covered.has(entry.image))
                            .map((entry) => entry.image)
                            .filter((image) => IMAGE_REFERENCE.test(image)),
                    ),
                ];

                const pullCode = await runComposeCommand(config, conn, stack, "pull", []);
                for (const image of extra) {
                    await runInProgressTerminal(conn, stack, ["pull", image], "docker pull");
                }

                // Pulling images for a stopped stack must not start it.
                await registry.refresh();
                if (registry.snapshot()[params.name]?.status !== RUNNING) return pullCode;

                // No --remove-orphans: an update fetches newer images, and deleting a container the
                // file stopped describing is not something a reader asked for by pressing update.
                const upCode = await runComposeCommand(config, conn, stack, "up", ["-d"]);

                const stranded = containers.filter((entry) => !entry.declared);
                if (stranded.length > 0) {
                    log.warn(
                        "stacks",
                        `${stack.name} holds ${stranded.length} container(s) its compose file does not declare, so they keep their old image: ${stranded.map((entry) => entry.name).join(", ")}`,
                    );
                }
                return upCode;
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
