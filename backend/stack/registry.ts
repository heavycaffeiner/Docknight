import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { StackSummary } from "../../common/stack.ts";
import { convertStatus } from "../../common/stack.ts";
import type { Config } from "../config.ts";
import { log } from "../log.ts";
import type { WsLayer } from "../ws/server.ts";
import { runCapture } from "./compose.ts";
import { probeComposeFileName, resolveExistingStack } from "./stack.ts";

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const REFRESH_INTERVAL_MS = 10_000;
const SCAN_MAX_AGE_MS = 60_000;
const OWN_STACK_NAME = "docknight";

interface StackListPsEntry {
    Name: string;
    Status: string;
    ConfigFiles?: string;
}

export interface Stack {
    name: string;
    dir: string;
    composeFileName: string;
}

export interface StackRegistry {
    snapshot(): Record<string, StackSummary>;
    /**
     * Rescan the stacks directory immediately (cheap, local filesystem only), so a mutation
     * such as a create or a delete is visible at once. Never calls `compose ls` itself,
     * preserving the one-`compose ls`-per-tick invariant; docker-reported status (running,
     * exited) catches up on the next periodic tick, at most `refreshIntervalMs` later.
     */
    markDirty(name: string): void;
    /** Broadcast the current (possibly not yet rescanned) snapshot to every authenticated connection. */
    emitStackList(): void;
    /** Starts the scan-plus-status-refresh timer; returns the stop function. */
    startRefreshTimer(): () => void;
    /**
     * Resolve a managed stack by name for a command that needs its directory.
     * @throws AppError("notFound", ..., "stackNotFound") for an unmanaged or absent stack.
     */
    resolve(name: string): Stack;
}

interface Entry extends StackSummary {
    configFilePath?: string;
}

export interface StackRegistryOptions {
    /** Overrides for tests; production uses the module constants. */
    refreshIntervalMs?: number;
}

/** Owns stack discovery, the docker compose ls-backed status cache, and the refresh timer. */
export function createStackRegistry(
    ws: WsLayer,
    config: Readonly<Config>,
    options: StackRegistryOptions = {},
): StackRegistry {
    const stacks = new Map<string, Entry>();
    let lastScanAt = 0;
    let dirty = false;

    function scan(): void {
        let entries: string[];
        try {
            entries = readdirSync(config.stacksDir, { withFileTypes: true })
                .filter((entry) => entry.isDirectory() && NAME_RE.test(entry.name))
                .map((entry) => entry.name);
        } catch (error) {
            log.warn("stack", "failed to scan the stacks directory", error);
            entries = [];
        }

        const next = new Map<string, Entry>();
        for (const name of entries) {
            const dir = join(config.stacksDir, name);
            const fileName = probeComposeFileName(dir);
            if (fileName === null) continue; // a directory without a compose file is not a stack
            const previous = stacks.get(name);
            next.set(name, {
                name,
                composeFileName: fileName,
                managed: true,
                status: previous?.status ?? 1, // DRAFT
            });
        }
        // Keep unmanaged entries (reported by compose ls but absent from the disk scan).
        for (const [name, entry] of stacks) {
            if (!entry.managed) next.set(name, entry);
        }
        stacks.clear();
        for (const [name, entry] of next) stacks.set(name, entry);
        lastScanAt = Date.now();
    }

    async function refreshStatus(): Promise<void> {
        const out = await runCapture(
            ["compose", "ls", "--all", "--format", "json"],
            config.stacksDir,
            10_000,
        );
        // Absent from ls means not deployed; every managed stack resets to DRAFT before the
        // parsed entries below overwrite the ones docker actually reports.
        for (const entry of stacks.values()) {
            if (entry.managed) entry.status = 1; // DRAFT
        }
        let parsed: StackListPsEntry[];
        try {
            const value: unknown = JSON.parse(out === "" ? "[]" : out);
            parsed = Array.isArray(value) ? (value as StackListPsEntry[]) : [];
        } catch {
            parsed = [];
        }
        for (const item of parsed) {
            if (item.Name === OWN_STACK_NAME) continue; // never manage ourselves
            let entry = stacks.get(item.Name);
            if (entry === undefined) {
                entry = { name: item.Name, managed: false, composeFileName: "", status: 0 };
                stacks.set(item.Name, entry);
            }
            entry.status = convertStatus(item.Status);
            entry.configFilePath = item.ConfigFiles;
        }
    }

    function snapshot(): Record<string, StackSummary> {
        const out: Record<string, StackSummary> = {};
        for (const [name, entry] of stacks) {
            out[name] = {
                name: entry.name,
                status: entry.status,
                managed: entry.managed,
                composeFileName: entry.composeFileName,
            };
        }
        return out;
    }

    function emitStackList(): void {
        ws.broadcastEvent((conn) => conn.userId !== null, "", "stackList", { stacks: snapshot() });
    }

    function markDirty(name: string): void {
        void name; // one process-wide rescan covers every stack; no per-name tracking needed
        scan();
        dirty = false;
    }

    function resolve(name: string): Stack {
        // Resolved from disk rather than the cached scan, so a stack created moments ago (not
        // yet picked up by the next periodic scan) is still usable.
        return resolveExistingStack(config.stacksDir, name);
    }

    function startRefreshTimer(): () => void {
        let stopped = false;
        const tick = async (): Promise<void> => {
            if (stopped) return;
            if (dirty || Date.now() - lastScanAt > SCAN_MAX_AGE_MS) {
                scan();
                dirty = false;
            }
            try {
                await refreshStatus();
            } catch (error) {
                log.warn("stack", "status refresh failed", error);
            }
            emitStackList();
        };

        scan(); // an immediate first scan, so stack.list has content before the first tick
        const timer = setInterval(() => void tick(), options.refreshIntervalMs ?? REFRESH_INTERVAL_MS);
        timer.unref();
        void tick();

        return () => {
            stopped = true;
            clearInterval(timer);
        };
    }

    return { snapshot, markDirty, emitStackList, startRefreshTimer, resolve };
}
