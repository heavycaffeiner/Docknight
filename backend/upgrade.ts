import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path/posix";
import { validation } from "../common/errors.ts";
import { noParams } from "../common/validate.ts";
import { COMMAND_GEOMETRY, UPGRADE_TERMINAL_NAME } from "../common/terminal.ts";
import type { Config } from "./config.ts";
import { log } from "./log.ts";
import { SHORT_TIMEOUT_MS, runCapture } from "./stack/compose.ts";
import * as terminals from "./terminal/registry.ts";
import type { Conn } from "./ws/conn.ts";
import { method } from "./ws/router.ts";

const DOCKER_SOCKET = "/var/run/docker.sock";

/** Lets the old container release its published ports before the replacement binds them. */
const HANDOFF_DELAY_SECONDS = 3;

const COMPOSE_LABELS = {
    project: "com.docker.compose.project",
    service: "com.docker.compose.service",
    workingDir: "com.docker.compose.project.working_dir",
    configFiles: "com.docker.compose.project.config_files",
} as const;

interface UpgradeTarget {
    image: string;
    project: string;
    service: string;
    workingDir: string;
    configFiles: string[];
}

type Resolution = { ok: true; target: UpgradeTarget } | { ok: false; reason: string };

/** Translation key of the last failure, kept so the UI can explain a terminal that ended badly. */
let lastError: string | undefined;

async function exists(path: string): Promise<boolean> {
    try {
        await access(path, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * The container id, taken from the three places the runtime leaves it. The hostname is last
 * because a deployment is free to set it to anything.
 */
async function selfContainerId(): Promise<string | undefined> {
    const mountinfo = await readFile("/proc/self/mountinfo", "utf8").catch(() => "");
    const mounted = /\/containers\/([0-9a-f]{64})\//.exec(mountinfo);
    if (mounted?.[1] !== undefined) return mounted[1];

    const cgroup = await readFile("/proc/self/cgroup", "utf8").catch(() => "");
    const grouped = /[0-9a-f]{64}/.exec(cgroup);
    if (grouped !== null) return grouped[0];

    const host = hostname();
    return /^[0-9a-f]{12}$/.test(host) ? host : undefined;
}

interface ContainerConfig {
    Image?: unknown;
    Labels?: unknown;
}

async function inspectConfig(id: string, cwd: string): Promise<ContainerConfig | undefined> {
    const result = await runCapture(
        ["inspect", "--format", "{{json .Config}}", id],
        cwd,
        SHORT_TIMEOUT_MS,
    ).catch(() => undefined);
    if (result === undefined || result.code !== 0) return undefined;
    try {
        const parsed: unknown = JSON.parse(result.stdout.trim());
        return typeof parsed === "object" && parsed !== null ? (parsed as ContainerConfig) : undefined;
    } catch (error) {
        log.debug("upgrade", "container config did not parse", error);
        return undefined;
    }
}

function label(labels: unknown, key: string): string {
    if (typeof labels !== "object" || labels === null) return "";
    const value = (labels as Record<string, unknown>)[key];
    return typeof value === "string" ? value.trim() : "";
}

/** Absolute, single-line POSIX paths only. Anything else is treated as an unusable deployment. */
function usablePath(value: string): boolean {
    return value.startsWith("/") && !/[\n\r]/.test(value);
}

/**
 * What the upgrade needs to know about this deployment, or why it cannot run. Every reason is a
 * translation key describing how the container was started, not a fault.
 */
async function resolveTarget(config: Readonly<Config>): Promise<Resolution> {
    if (!config.isContainer) return { ok: false, reason: "upgradeNotContainer" };
    if (!(await exists(DOCKER_SOCKET))) return { ok: false, reason: "upgradeNoSocket" };

    const id = await selfContainerId();
    if (id === undefined) return { ok: false, reason: "upgradeSelfUnknown" };

    const inspected = await inspectConfig(id, config.stacksDir);
    if (inspected === undefined) return { ok: false, reason: "upgradeSelfUnknown" };

    const image = typeof inspected.Image === "string" ? inspected.Image.trim() : "";
    const project = label(inspected.Labels, COMPOSE_LABELS.project);
    const service = label(inspected.Labels, COMPOSE_LABELS.service);
    const workingDir = label(inspected.Labels, COMPOSE_LABELS.workingDir);
    const configFiles = label(inspected.Labels, COMPOSE_LABELS.configFiles)
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");

    const usable =
        image !== "" &&
        project !== "" &&
        service !== "" &&
        usablePath(workingDir) &&
        configFiles.length > 0 &&
        configFiles.every(usablePath);
    if (!usable) return { ok: false, reason: "upgradeNotCompose" };

    return { ok: true, target: { image, project, service, workingDir, configFiles } };
}

function composeArgv(target: UpgradeTarget, ...rest: string[]): string[] {
    const argv = [
        "compose",
        "--project-name",
        target.project,
        "--project-directory",
        target.workingDir,
    ];
    for (const file of target.configFiles) argv.push("--file", file);
    argv.push(...rest);
    return argv;
}

/** POSIX single-quoting, so a path cannot break out of the helper's `sh -c` string. */
function quote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * The helper reads the compose file from the host, so every directory holding one is mounted at
 * its own path. Bind mounts declared inside the file are resolved by the daemon, not here.
 */
function mountDirectories(target: UpgradeTarget): string[] {
    const dirs = new Set<string>([target.workingDir]);
    for (const file of target.configFiles) dirs.add(dirname(file));
    return [...dirs];
}

function handoffArgv(target: UpgradeTarget): string[] {
    const argv = ["run", "--detach", "--rm", "--label", "com.docknight.role=upgrade"];
    argv.push("--volume", `${DOCKER_SOCKET}:${DOCKER_SOCKET}`);
    for (const dir of mountDirectories(target)) argv.push("--volume", `${dir}:${dir}`);

    const inner = ["docker", ...composeArgv(target, "up", "--detach", target.service)]
        .map(quote)
        .join(" ");
    argv.push(
        "--workdir",
        target.workingDir,
        "--entrypoint",
        "sh",
        target.image,
        "-c",
        `sleep ${HANDOFF_DELAY_SECONDS}; exec ${inner}`,
    );
    return argv;
}

export function isRunning(): boolean {
    return terminals.has(UPGRADE_TERMINAL_NAME);
}

/**
 * Pull the new image with the output streamed to `conn`, then hand the recreate to a container
 * outside this one. A container cannot recreate itself: `compose up` stops the old container,
 * which kills the CLI issuing the command before it starts the replacement.
 *
 * Resolves once the pull has started, not once the upgrade is done. The process is killed partway
 * through by design, so there is no later moment at which a response could be sent.
 */
export async function startUpgrade(config: Readonly<Config>, conn: Conn | null): Promise<string> {
    const resolution = await resolveTarget(config);
    if (!resolution.ok) {
        throw validation(`self upgrade is unavailable: ${resolution.reason}`, {
            i18n: resolution.reason,
        });
    }
    const target = resolution.target;
    lastError = undefined;

    // The pull is the slow half and the only half that is free to fail: a failed pull leaves the
    // running container exactly as it was.
    const pull = terminals.run(
        UPGRADE_TERMINAL_NAME,
        "docker",
        composeArgv(target, "pull", target.service),
        target.workingDir,
        conn,
        COMMAND_GEOMETRY,
    );

    void pull
        .then(async (exitCode) => {
            if (exitCode !== 0) {
                lastError = "upgradePullFailed";
                log.warn("upgrade", `pull exited ${exitCode}; this container is untouched`);
                return;
            }
            const result = await runCapture(handoffArgv(target), target.workingDir, SHORT_TIMEOUT_MS);
            if (result.code !== 0) {
                lastError = "upgradeHandoffFailed";
                log.error("upgrade", `handoff refused: ${result.stderr.trim().slice(0, 500)}`);
                return;
            }
            log.info("upgrade", `handoff container ${result.stdout.trim().slice(0, 12)} started`);
        })
        .catch((error: unknown) => {
            lastError = "upgradeHandoffFailed";
            log.error("upgrade", "upgrade did not complete", error);
        });

    return UPGRADE_TERMINAL_NAME;
}

export function registerUpgradeMethods(config: Readonly<Config>): void {
    method("upgrade.status", {
        requiresAuth: true,
        routable: false,
        parse: noParams,
        handle: async () => {
            const resolution = await resolveTarget(config);
            return {
                supported: resolution.ok,
                reason: resolution.ok ? undefined : resolution.reason,
                image: resolution.ok ? resolution.target.image : undefined,
                running: isRunning(),
                terminal: UPGRADE_TERMINAL_NAME,
                lastError,
            };
        },
    });

    method("upgrade.start", {
        requiresAuth: true,
        routable: false,
        parse: noParams,
        handle: async (conn) => ({ terminal: await startUpgrade(config, conn) }),
    });
}
