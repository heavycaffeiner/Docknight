import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { hostname as osHostname } from "node:os";
import { AppError } from "../common/errors.ts";
import type { Config } from "./config.ts";
import { runCapture } from "./stack/compose.ts";
import { log } from "./log.ts";
import type { Conn } from "./ws/conn.ts";
import type { TerminalRegistry } from "./terminal/registry.ts";

export const UPGRADE_TERMINAL = "upgrade";

export interface UpgradeTarget {
    image: string;
    project: string;
    service: string;
    workingDir: string;
    configFiles: string[];
}

export type ResolveResult = UpgradeTarget | { reason: string };

function isFailure(result: ResolveResult): result is { reason: string } {
    return "reason" in result;
}

/**
 * Paths from `docker inspect` are interpolated into the helper container's shell command
 * string (see `startUpgrade`); each one must be an absolute, single-line path or the target is
 * refused outright, before any of them reach a spawned process.
 */
function isSafePath(value: string): boolean {
    return value.startsWith("/") && !value.includes("\n");
}

export interface SelfIdSources {
    mountinfoPath: string;
    cgroupPath: string;
    hostname: string;
}

const DEFAULT_SOURCES: SelfIdSources = {
    mountinfoPath: "/proc/self/mountinfo",
    cgroupPath: "/proc/self/cgroup",
    hostname: osHostname(),
};

function readFileIfExists(path: string): string | null {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return null;
    }
}

/**
 * The running container's own id, tried in order: the docker-managed mount path in
 * mountinfo, the cgroup path (both survive a custom hostname), then the hostname itself when
 * it already looks like a short container id.
 */
export function selfContainerId(sources: SelfIdSources = DEFAULT_SOURCES): string | null {
    const mountinfo = readFileIfExists(sources.mountinfoPath);
    if (mountinfo !== null) {
        const match = /\/docker\/containers\/([0-9a-f]{12,64})\//.exec(mountinfo);
        if (match?.[1] !== undefined) return match[1];
    }

    const cgroup = readFileIfExists(sources.cgroupPath);
    if (cgroup !== null) {
        const match = /\/docker[/-]([0-9a-f]{12,64})(?:\.scope)?/.exec(cgroup);
        if (match?.[1] !== undefined) return match[1];
    }

    if (/^[0-9a-f]{12}$/.test(sources.hostname)) return sources.hostname;
    return null;
}

interface InspectConfig {
    Image?: string;
    Labels?: Record<string, string>;
}

export interface ResolveTargetDeps {
    sources: SelfIdSources;
    /** True when the docker socket path exists; overridable so a test never touches the real one. */
    socketExists: () => boolean;
    /** Runs `docker inspect --format {{json .Config}} <id>` and returns its stdout. */
    inspect: (id: string) => Promise<string>;
}

const DEFAULT_DEPS: ResolveTargetDeps = {
    sources: DEFAULT_SOURCES,
    socketExists: () => existsSync("/var/run/docker.sock"),
    inspect: (id) => runCapture(["inspect", "--format", "{{json .Config}}", id], "/", 10_000),
};

/**
 * Resolve what this container would need to pull and restart itself: only possible when
 * running as a container, with the docker socket mounted, self-identifiable, and started by
 * compose (the labels compose itself sets, not anything Docknight invents).
 */
export async function resolveTarget(
    config: Readonly<Config>,
    deps: ResolveTargetDeps = DEFAULT_DEPS,
): Promise<ResolveResult> {
    if (!config.isContainer) return { reason: "upgradeNotContainer" };
    if (!deps.socketExists()) return { reason: "upgradeNoSocket" };

    const id = selfContainerId(deps.sources);
    if (id === null) return { reason: "upgradeSelfUnknown" };

    let raw: string;
    try {
        raw = await deps.inspect(id);
    } catch {
        return { reason: "upgradeSelfUnknown" };
    }

    let parsed: InspectConfig;
    try {
        parsed = JSON.parse(raw) as InspectConfig;
    } catch {
        return { reason: "upgradeSelfUnknown" };
    }

    const image = parsed.Image;
    const labels = parsed.Labels ?? {};
    const project = labels["com.docker.compose.project"];
    const service = labels["com.docker.compose.service"];
    const workingDir = labels["com.docker.compose.project.working_dir"];
    const configFilesRaw = labels["com.docker.compose.project.config_files"];
    if (
        image === undefined ||
        project === undefined ||
        service === undefined ||
        workingDir === undefined ||
        configFilesRaw === undefined
    ) {
        return { reason: "upgradeNotCompose" };
    }
    const configFiles = configFilesRaw.split(",");

    for (const path of [workingDir, ...configFiles]) {
        if (!isSafePath(path)) return { reason: "upgradeNotCompose" };
    }

    return { image, project, service, workingDir, configFiles };
}

/** POSIX single-quoting: closes the quote, escapes a literal quote, reopens it. */
export function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface UpgradeState {
    running: boolean;
    lastError: string | undefined;
}

const state: UpgradeState = { running: false, lastError: undefined };

export function upgradeIsRunning(): boolean {
    return state.running;
}

export interface UpgradeStatusPayload {
    supported: boolean;
    reason?: string;
    image?: string;
    running: boolean;
    terminal: string;
    lastError?: string;
}

export async function upgradeStatus(config: Readonly<Config>): Promise<UpgradeStatusPayload> {
    const target = await resolveTarget(config);
    return {
        supported: !isFailure(target),
        ...(isFailure(target) ? { reason: target.reason } : { image: target.image }),
        running: state.running,
        terminal: UPGRADE_TERMINAL,
        ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
    };
}

/**
 * Spawn the detached helper container that finishes the upgrade after this process is gone:
 * pull already succeeded, so this half only has to survive `docknight` itself dying mid-command,
 * which `detached` and `unref` are exactly for.
 */
function spawnHandoff(target: UpgradeTarget): void {
    const inner =
        `sleep 3; exec docker compose --project-directory ${shellQuote(target.workingDir)}` +
        `${target.configFiles.map((f) => ` -f ${shellQuote(f)}`).join("")}` +
        ` up --detach ${shellQuote(target.service)}`;

    const mountDirs = new Set<string>([target.workingDir, ...target.configFiles.map((f) => dirname(f))]);
    const volumes = ["-v", "/var/run/docker.sock:/var/run/docker.sock"];
    for (const dir of mountDirs) volumes.push("-v", `${dir}:${dir}`);

    const child = spawn(
        "docker",
        ["run", "--detach", "--rm", ...volumes, "--entrypoint", "sh", target.image, "-c", inner],
        { detached: true, stdio: "ignore" },
    );
    child.unref();
}

/**
 * Pull the target image in the named terminal, then hand off to a detached helper container.
 * Resolves once the pull has *started*; there is no later moment to answer from, since this
 * process is expected to be replaced partway through the handoff by design.
 */
export async function startUpgrade(
    config: Readonly<Config>,
    conn: Conn | null,
    terminals: TerminalRegistry,
): Promise<{ terminal: string }> {
    if (state.running) throw new AppError("conflict", "an upgrade is already running", "upgradeAlreadyRunning");

    const target = await resolveTarget(config);
    if (isFailure(target)) {
        throw new AppError("validation", `upgrade unavailable: ${target.reason}`, target.reason);
    }

    state.running = true;
    state.lastError = undefined;

    const composeBase = [
        "compose",
        "--project-directory",
        target.workingDir,
        ...target.configFiles.flatMap((f) => ["-f", f]),
    ];

    // run() reports a spawn failure by throwing synchronously, not by rejecting, so the
    // try/catch has to wrap the call itself: without it a missing docker binary would leave
    // state.running stuck true and every later upgrade attempt would answer conflict.
    let pull: Promise<number>;
    try {
        pull = terminals.run(
            UPGRADE_TERMINAL,
            "docker",
            [...composeBase, "pull", target.service],
            target.workingDir,
            conn,
        );
    } catch (error) {
        state.running = false;
        state.lastError = "upgradePullFailed";
        throw error;
    }

    pull
        .then((code) => {
            if (code !== 0) {
                state.running = false;
                state.lastError = "upgradePullFailed";
                log.warn("upgrade", `pull exited ${code}, upgrade aborted`);
                return;
            }
            spawnHandoff(target);
            // state.running is intentionally left true: this process is about to be replaced,
            // and there is no later tick that would ever set it back to false.
        })
        .catch((error: unknown) => {
            state.running = false;
            state.lastError = "upgradePullFailed";
            log.warn("upgrade", "pull failed", error);
        });

    return { terminal: UPGRADE_TERMINAL };
}
