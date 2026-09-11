import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { AppError } from "../../common/errors.ts";
import { bool, noParams, obj, str } from "../../common/validate.ts";
import { GEOMETRY, composeTerminalName, logsTerminalName } from "../../common/terminal.ts";
import type { ServiceInstance, StackDetail } from "../../common/stack.ts";
import { RUNNING } from "../../common/stack.ts";
import type { Config } from "../config.ts";
import { log } from "../log.ts";
import { Settings } from "../settings.ts";
import type { Conn } from "../ws/conn.ts";
import { method } from "../ws/router.ts";
import type { StackResolver } from "../terminal/methods.ts";
import type { TerminalRegistry } from "../terminal/registry.ts";
import { composeArgs, runCapture } from "./compose.ts";
import type { StackRegistry } from "./registry.ts";
import { isInsideStacksDir, readStack, resolveStackPath, validateStackFiles } from "./stack.ts";
import { withStackLock } from "./lock.ts";
import { writeStack } from "./write.ts";

declare module "../../common/protocol.ts" {
    interface MethodMap {
        "stack.list": { params: undefined; result: { stacks: Record<string, unknown> } };
        "stack.get": { params: { name: string }; result: { stack: unknown } };
        "stack.save": {
            params: { name: string; composeYAML: string; composeENV: string; isCreate: boolean };
            result: { ok: true };
        };
        "stack.deploy": {
            params: { name: string; composeYAML: string; composeENV: string; isCreate: boolean };
            result: { exitCode: number };
        };
        "stack.start": { params: { name: string }; result: { exitCode: number } };
        "stack.stop": { params: { name: string }; result: { exitCode: number } };
        "stack.restart": { params: { name: string }; result: { exitCode: number } };
        "stack.down": { params: { name: string }; result: { exitCode: number } };
        "stack.update": { params: { name: string }; result: { exitCode: number } };
        "stack.delete": { params: { name: string }; result: { exitCode: number } };
        "stack.serviceStatus": {
            params: { name: string };
            result: { services: Record<string, ServiceInstance[]> };
        };
        "service.start": { params: { stack: string; service: string }; result: { exitCode: number } };
        "service.stop": { params: { stack: string; service: string }; result: { exitCode: number } };
        "service.restart": {
            params: { stack: string; service: string };
            result: { exitCode: number };
        };
        "docker.stats": { params: undefined; result: { stats: Record<string, unknown> } };
        "docker.networks": { params: undefined; result: { networks: string[] } };
    }
}

export interface ComposePsRecord {
    Service?: string;
    Name?: string;
    Health?: string;
    State?: string;
}

interface DockerStatsRecord {
    Name?: string;
    [key: string]: unknown;
}

/**
 * Parse `docker compose ps --format json` output, which is either one JSON array or one JSON
 * object per line depending on the compose release. A line that fails to parse is skipped
 * rather than fatal.
 */
export function parsePsOutput(out: string): ComposePsRecord[] {
    const trimmed = out.trim();
    if (trimmed === "") return [];
    if (trimmed.startsWith("[")) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            return Array.isArray(parsed) ? (parsed as ComposePsRecord[]) : [];
        } catch {
            return [];
        }
    }
    const records: ComposePsRecord[] = [];
    for (const line of trimmed.split("\n")) {
        if (line.trim() === "") continue;
        try {
            records.push(JSON.parse(line) as ComposePsRecord);
        } catch {
            continue; // a garbage line never fails the whole call
        }
    }
    return records;
}

/** Group parsed `docker compose ps` records by service name; Health wins over State. */
export function groupServiceStatus(records: ComposePsRecord[]): Record<string, ServiceInstance[]> {
    const services: Record<string, ServiceInstance[]> = {};
    for (const record of records) {
        const serviceName = record.Service;
        if (serviceName === undefined) continue;
        const list = services[serviceName] ?? [];
        list.push({ name: record.Name ?? "", status: record.Health ?? record.State ?? "" });
        services[serviceName] = list;
    }
    return services;
}

const nameParse = obj({ name: str({ max: 128 }) });
const saveParse = obj({
    name: str({ max: 128 }),
    composeYAML: str({ max: 1024 * 1024 }),
    composeENV: str({ max: 1024 * 1024 }),
    isCreate: bool(),
});
const serviceParse = obj({ stack: str({ max: 128 }), service: str({ max: 128 }) });

const EXTERNAL_READ_CAP = 1024 * 1024;

/**
 * Read a compose file docker reported for a project with no Docknight directory. The read is
 * capped and best-effort: a missing or oversized file yields empty text rather than failing
 * the screen. The caller has already confirmed the path is inside the stacks directory.
 */
async function readExternalFile(path: string): Promise<string> {
    try {
        if (statSync(path).size > EXTERNAL_READ_CAP) return "";
        return await readFile(path, "utf8");
    } catch {
        return "";
    }
}

export function registerStackMethods(
    registry: StackRegistry,
    terminals: TerminalRegistry,
    config: Readonly<Config>,
): void {
    function joinFollowLog(conn: Conn, name: string, stackDir: string): void {
        const logsName = logsTerminalName(conn.endpoint, name);
        terminals.getOrCreate(
            logsName,
            "follow",
            "docker",
            composeArgs(config.stacksDir, stackDir, "logs", "-f", "--tail", "100"),
            stackDir,
            GEOMETRY.follow,
        );
        terminals.join(conn, logsName);
    }

    async function runLong(
        conn: Conn,
        name: string,
        stackDir: string,
        command: string,
        extra: string[],
    ): Promise<{ exitCode: number }> {
        return withStackLock(name, async () => {
            const terminalName = composeTerminalName(conn.endpoint, name);
            const exitCode = await terminals.run(
                terminalName,
                "docker",
                composeArgs(config.stacksDir, stackDir, command, ...extra),
                stackDir,
                conn,
            );
            registry.markDirty(name);
            registry.emitStackList();
            if (exitCode !== 0) {
                throw new AppError("commandFailed", `exit ${exitCode}`, "composeCommandFailed", {
                    code: exitCode,
                });
            }
            return { exitCode };
        });
    }

    method("stack.list", {
        requiresAuth: true,
        routable: true,
        parse: noParams(),
        handle: () => ({ stacks: registry.snapshot() }),
    });

    /**
     * A project `docker compose ls` reports that has no directory of its own under the stacks
     * directory. It is served read only, and only when its compose file still resolves inside
     * the stacks directory: `ConfigFiles` is subprocess output, so any process with socket
     * access could otherwise point Docknight at an arbitrary file on the host.
     */
    async function readExternalStack(name: string): Promise<StackDetail | null> {
        const external = registry.externalComposePath(name);
        if (external === null) return null;

        const resolved = resolve(external);
        if (!isInsideStacksDir(config.stacksDir, resolved)) return null;

        return {
            name,
            status: 0,
            managed: false,
            composeFileName: basename(resolved),
            composeYAML: await readExternalFile(resolved),
            composeENV: await readExternalFile(join(dirname(resolved), ".env")),
            primaryHostname: "",
        };
    }

    method("stack.get", {
        requiresAuth: true,
        routable: true,
        parse: nameParse,
        handle: async (conn: Conn, params) => {
            const dir = resolveStackPath(config.stacksDir, params.name);
            const detail = existsSync(dir)
                ? await readStack(config.stacksDir, params.name)
                : await readExternalStack(params.name);
            if (detail === null) {
                throw new AppError("notFound", `no stack named ${params.name}`, "stackNotFound");
            }
            detail.primaryHostname = (Settings.get("primaryHostname") as string | undefined) ?? "";
            // A stack whose files live outside the stacks directory has no cwd of its own to
            // follow logs from, and is served read only.
            if (detail.managed) joinFollowLog(conn, params.name, dir);
            return { stack: detail };
        },
    });

    /*
     * There is deliberately no adoption path. A stack whose compose file lives outside the
     * stacks directory is readable but never writable: copying it in would leave two files
     * for one project, and the user would have no way to tell which one docker last used.
     */

    method("stack.save", {
        requiresAuth: true,
        routable: true,
        parse: saveParse,
        handle: async (_conn: Conn, params) => {
            validateStackFiles(config.stacksDir, params.name, params.composeYAML, params.composeENV);
            await writeStack(config, params.name, params.composeYAML, params.composeENV, params.isCreate);
            registry.markDirty(params.name);
            registry.emitStackList();
            return { ok: true as const };
        },
    });

    method("stack.deploy", {
        requiresAuth: true,
        routable: true,
        parse: saveParse,
        handle: async (conn: Conn, params) => {
            validateStackFiles(config.stacksDir, params.name, params.composeYAML, params.composeENV);
            await writeStack(config, params.name, params.composeYAML, params.composeENV, params.isCreate);
            const dir = resolveStackPath(config.stacksDir, params.name);
            joinFollowLog(conn, params.name, dir);
            return runLong(conn, params.name, dir, "up", ["-d", "--remove-orphans"]);
        },
    });

    method("stack.start", {
        requiresAuth: true,
        routable: true,
        parse: nameParse,
        handle: (conn: Conn, params) => {
            const stack = registry.resolve(params.name);
            joinFollowLog(conn, params.name, stack.dir);
            return runLong(conn, params.name, stack.dir, "up", ["-d", "--remove-orphans"]);
        },
    });

    method("stack.stop", {
        requiresAuth: true,
        routable: true,
        parse: nameParse,
        handle: (conn: Conn, params) => {
            const stack = registry.resolve(params.name);
            terminals.leave(conn, logsTerminalName(conn.endpoint, params.name));
            return runLong(conn, params.name, stack.dir, "stop", []);
        },
    });

    method("stack.restart", {
        requiresAuth: true,
        routable: true,
        parse: nameParse,
        handle: (conn: Conn, params) => {
            const stack = registry.resolve(params.name);
            return runLong(conn, params.name, stack.dir, "restart", []);
        },
    });

    method("stack.down", {
        requiresAuth: true,
        routable: true,
        parse: nameParse,
        handle: (conn: Conn, params) => {
            const stack = registry.resolve(params.name);
            return runLong(conn, params.name, stack.dir, "down", []);
        },
    });

    method("stack.update", {
        requiresAuth: true,
        routable: true,
        parse: nameParse,
        handle: (conn: Conn, params) => {
            const stack = registry.resolve(params.name);
            return withStackLock(params.name, async () => {
                const terminalName = composeTerminalName(conn.endpoint, params.name);
                const pullExit = await terminals.run(
                    terminalName,
                    "docker",
                    composeArgs(config.stacksDir, stack.dir, "pull"),
                    stack.dir,
                    conn,
                );
                if (pullExit !== 0) {
                    registry.markDirty(params.name);
                    registry.emitStackList();
                    throw new AppError("commandFailed", `exit ${pullExit}`, "composeCommandFailed", {
                        code: pullExit,
                    });
                }

                registry.markDirty(params.name);
                const wasRunning = registry.snapshot()[params.name]?.status === RUNNING;
                if (wasRunning) {
                    const upExit = await terminals.run(
                        terminalName,
                        "docker",
                        composeArgs(config.stacksDir, stack.dir, "up", "-d", "--remove-orphans"),
                        stack.dir,
                        conn,
                    );
                    if (upExit !== 0) {
                        registry.markDirty(params.name);
                        registry.emitStackList();
                        throw new AppError("commandFailed", `exit ${upExit}`, "composeCommandFailed", {
                            code: upExit,
                        });
                    }
                }
                registry.markDirty(params.name);
                registry.emitStackList();
                return { exitCode: 0 };
            });
        },
    });

    method("stack.delete", {
        requiresAuth: true,
        routable: true,
        parse: nameParse,
        handle: (conn: Conn, params) => {
            const stack = registry.resolve(params.name);
            return withStackLock(params.name, async () => {
                const dir = resolveStackPath(config.stacksDir, params.name);
                const stat = lstatSync(dir);
                if (!stat.isDirectory() || stat.isSymbolicLink()) {
                    throw new AppError(
                        "validation",
                        `${params.name} is not a plain directory`,
                        "invalidStackName",
                    );
                }

                const terminalName = composeTerminalName(conn.endpoint, params.name);
                const exitCode = await terminals.run(
                    terminalName,
                    "docker",
                    composeArgs(config.stacksDir, stack.dir, "down", "--remove-orphans"),
                    stack.dir,
                    conn,
                );
                if (exitCode !== 0) {
                    registry.markDirty(params.name);
                    registry.emitStackList();
                    throw new AppError("commandFailed", `exit ${exitCode}`, "composeCommandFailed", {
                        code: exitCode,
                    });
                }

                await rm(dir, { recursive: true });
                registry.markDirty(params.name);
                registry.emitStackList();
                return { exitCode };
            });
        },
    });

    method("stack.serviceStatus", {
        requiresAuth: true,
        routable: true,
        parse: nameParse,
        handle: async (_conn: Conn, params) => {
            const stack = registry.resolve(params.name);
            const out = await runCapture(
                composeArgs(config.stacksDir, stack.dir, "ps", "--format", "json"),
                stack.dir,
                10_000,
            );
            return { services: groupServiceStatus(parsePsOutput(out)) };
        },
    });

    method("service.start", {
        requiresAuth: true,
        routable: true,
        parse: serviceParse,
        handle: (conn: Conn, params) => {
            const stack = registry.resolve(params.stack);
            return runLong(conn, params.stack, stack.dir, "up", ["-d", params.service]);
        },
    });

    method("service.stop", {
        requiresAuth: true,
        routable: true,
        parse: serviceParse,
        handle: (conn: Conn, params) => {
            const stack = registry.resolve(params.stack);
            return runLong(conn, params.stack, stack.dir, "stop", [params.service]);
        },
    });

    method("service.restart", {
        requiresAuth: true,
        routable: true,
        parse: serviceParse,
        handle: (conn: Conn, params) => {
            const stack = registry.resolve(params.stack);
            return runLong(conn, params.stack, stack.dir, "restart", [params.service]);
        },
    });

    method("docker.stats", {
        requiresAuth: true,
        routable: true,
        parse: noParams(),
        handle: async () => {
            try {
                const out = await runCapture(
                    ["stats", "--format", "json", "--no-stream"],
                    config.stacksDir,
                    15_000,
                );
                const stats: Record<string, unknown> = {};
                for (const line of out.split("\n")) {
                    if (line.trim() === "") continue;
                    try {
                        const record = JSON.parse(line) as DockerStatsRecord;
                        if (typeof record.Name === "string") stats[record.Name] = record;
                    } catch {
                        continue;
                    }
                }
                return { stats };
            } catch (error) {
                log.warn("stack", "docker.stats failed", error);
                return { stats: {} };
            }
        },
    });

    method("docker.networks", {
        requiresAuth: true,
        routable: true,
        parse: noParams(),
        handle: async () => {
            try {
                const out = await runCapture(
                    ["network", "ls", "--format", "{{.Name}}"],
                    config.stacksDir,
                    10_000,
                );
                const networks = out
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line !== "")
                    .sort((a, b) => a.localeCompare(b));
                return { networks };
            } catch (error) {
                log.warn("stack", "docker.networks failed", error);
                return { networks: [] };
            }
        },
    });
}

/** Read the service names declared in a stack's compose file, for terminal.exec's check. */
function serviceNamesOf(stackDir: string, composeFileName: string): string[] {
    const text = readFileSync(join(stackDir, composeFileName), "utf8");
    const doc = parseDocument(text);
    if (doc.errors.length > 0) return [];
    const root: unknown = doc.toJS();
    if (typeof root !== "object" || root === null) return [];
    const services = (root as Record<string, unknown>).services;
    if (typeof services !== "object" || services === null || Array.isArray(services)) return [];
    return Object.keys(services);
}

/** Adapts the stack registry to the terminal layer's StackResolver, for terminal.exec. */
export function stackResolverFor(registry: StackRegistry, config: Readonly<Config>): StackResolver {
    return {
        resolveForExec(name: string): { dir: string; serviceNames: string[] } {
            const stack = registry.resolve(name);
            return { dir: stack.dir, serviceNames: serviceNamesOf(stack.dir, stack.composeFileName) };
        },
        composeExecArgs(stackDir: string, service: string, shell: string): string[] {
            return composeArgs(config.stacksDir, stackDir, "exec", service, shell);
        },
    };
}
