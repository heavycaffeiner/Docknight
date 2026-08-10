import { readdir } from "node:fs/promises";
import {
    DEFAULT_COMPOSE_FILE_NAME,
    DRAFT,
    STACK_NAME_PATTERN,
    UNKNOWN,
    convertStatus,
    type StackSummary,
} from "../../common/stack.ts";
import { LOCAL_ENDPOINT } from "../../common/protocol.ts";
import type { Config } from "../config.ts";
import { log } from "../log.ts";
import { emitToAuthenticated } from "../ws/hub.ts";
import { SHORT_TIMEOUT_MS, parseJsonRecords, runCapture } from "./compose.ts";
import { probeComposeFileName } from "./stack.ts";

const REFRESH_INTERVAL_MS = 10_000;
const SCAN_MIN_INTERVAL_MS = 60_000;

/** Docknight must not manage the stack that deploys Docknight. */
const SELF_PROJECT_NAME = "docknight";

interface ComposeLsEntry {
    Name: string;
    Status: string;
    ConfigFiles?: string;
}

let config: Readonly<Config> | null = null;
let summaries: Record<string, StackSummary> = {};
let lastScanAt = 0;
let dirty = true;
let timer: NodeJS.Timeout | null = null;
let refreshing = false;

export function init(next: Readonly<Config>): void {
    config = next;
}

function requireConfig(): Readonly<Config> {
    if (config === null) throw new Error("stack registry is not initialised");
    return config;
}

/** Force a filesystem scan on the next tick, after any mutation. */
export function markDirty(): void {
    dirty = true;
}

export function snapshot(): Record<string, StackSummary> {
    return summaries;
}

/**
 * Discover stacks by directory. A directory without a compose file is not a stack, and a name
 * that fails the policy is skipped rather than half-managed.
 */
async function scan(): Promise<Record<string, StackSummary>> {
    const current = requireConfig();
    const result: Record<string, StackSummary> = {};
    let entries;
    try {
        entries = await readdir(current.stacksDir, { withFileTypes: true });
    } catch (error) {
        log.warn("stacks", `cannot read ${current.stacksDir}`, error);
        return result;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!STACK_NAME_PATTERN.test(entry.name)) continue;
        const composeFileName = await probeComposeFileName(`${current.stacksDir}/${entry.name}`);
        if (composeFileName === null) continue;
        result[entry.name] = {
            name: entry.name,
            status: DRAFT,
            managed: true,
            composeFileName,
        };
    }
    return result;
}

/** Merge what `docker compose ls` reports over the scanned set. */
async function refreshStatus(stacks: Record<string, StackSummary>): Promise<void> {
    const result = await runCapture(
        ["compose", "ls", "--all", "--format", "json"],
        requireConfig().stacksDir,
        SHORT_TIMEOUT_MS,
    ).catch((error: unknown) => {
        log.warn("stacks", "docker compose ls failed", error);
        return null;
    });
    if (result === null || result.code !== 0) {
        if (result !== null) {
            log.warn("stacks", `docker compose ls exited ${result.code}: ${result.stderr.slice(0, 200)}`);
        }
        return;
    }

    for (const entry of parseJsonRecords<ComposeLsEntry>(result.stdout)) {
        if (typeof entry.Name !== "string" || entry.Name === "") continue;
        let stack = stacks[entry.Name];
        if (stack === undefined) {
            if (entry.Name === SELF_PROJECT_NAME) continue;
            // Deployed but not under the stacks directory.
            stack = {
                name: entry.Name,
                status: UNKNOWN,
                managed: false,
                composeFileName: DEFAULT_COMPOSE_FILE_NAME,
            };
            stacks[entry.Name] = stack;
        }
        stack.status = convertStatus(entry.Status ?? "");
    }
}

/**
 * One tick: scan when dirty or stale, then one `docker compose ls` regardless of how many
 * clients are connected, then one `stackList` event to every authenticated connection.
 */
export async function refresh(): Promise<Record<string, StackSummary>> {
    if (refreshing) return summaries;
    refreshing = true;
    try {
        const stale = Date.now() - lastScanAt > SCAN_MIN_INTERVAL_MS;
        if (dirty || stale || Object.keys(summaries).length === 0) {
            summaries = await scan();
            lastScanAt = Date.now();
            dirty = false;
        } else {
            // Keep the same object identity out of the way of concurrent readers.
            summaries = Object.fromEntries(
                Object.entries(summaries)
                    .filter(([, stack]) => stack.managed)
                    .map(([name, stack]) => [name, { ...stack }]),
            );
        }
        await refreshStatus(summaries);
        return summaries;
    } finally {
        refreshing = false;
    }
}

export function emitStackList(): void {
    emitToAuthenticated("stackList", LOCAL_ENDPOINT, { stacks: summaries });
}

/** Rescan and push, used after every mutation. */
export async function refreshAndEmit(): Promise<void> {
    markDirty();
    await refresh();
    emitStackList();
}

export function startRefreshTimer(): void {
    if (timer !== null) return;
    const tick = (): void => {
        void refresh()
            .then(() => emitStackList())
            .catch((error: unknown) => log.warn("stacks", "refresh tick failed", error));
    };
    tick();
    timer = setInterval(tick, REFRESH_INTERVAL_MS);
    timer.unref();
}

export function stopRefreshTimer(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
}
