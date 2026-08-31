import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.ts";
import { log } from "./log.ts";
import { Settings } from "./settings.ts";

interface PackageManifest {
    version: string;
}

const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as PackageManifest;

/** The running application version, read once from package.json at module load. */
export const VERSION = manifest.version;

/**
 * Set by the version check timer. Starts undefined, so a fresh process reports nothing in the
 * `info` event until the first check completes.
 */
let latestVersion: string | undefined;

export function getLatestVersion(): string | undefined {
    return latestVersion;
}

export function setLatestVersion(next: string | undefined): void {
    latestVersion = next;
}

/**
 * Numeric, dot-separated version comparison: `a` newer than `b`. A component that fails to
 * parse as a number, or a candidate with no digits at all, makes the whole comparison false
 * rather than throwing; a malformed manifest value must never look newer than what is running.
 */
export function isNewer(a: string, b: string): boolean {
    const partsA = a.split(".").map((p) => Number.parseInt(p, 10));
    const partsB = b.split(".").map((p) => Number.parseInt(p, 10));
    if (partsA.some((p) => !Number.isFinite(p)) || partsB.some((p) => !Number.isFinite(p))) return false;
    if (partsA.length === 0 || partsB.length === 0) return false;

    const length = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < length; i += 1) {
        const av = partsA[i] ?? 0;
        const bv = partsB[i] ?? 0;
        if (av !== bv) return av > bv;
    }
    return false;
}

/** True for a string this module is willing to store and compare as a version. */
function parsesAsVersion(value: unknown): value is string {
    return typeof value === "string" && /^\d+(\.\d+)*$/.test(value);
}

interface VersionManifest {
    stable?: unknown;
    beta?: unknown;
}

const FETCH_TIMEOUT_MS = 10_000;
const CHECK_INTERVAL_MS = 48 * 60 * 60 * 1000;

export interface VersionCheckDeps {
    /** Called after a successful check whose candidate changed latestVersion. */
    onLatestVersionChanged?: () => void;
    /** Called when a newer version is found and autoUpgrade is on, and no upgrade is running. */
    onAutoUpgrade?: (config: Readonly<Config>) => void;
}

async function check(config: Readonly<Config>, deps: VersionCheckDeps): Promise<void> {
    // Read per call, not cached at startup: toggling the setting takes effect on the very next
    // timer tick without a restart, and no request happens at all while it is off.
    if (Settings.get("checkUpdate") !== true) return;

    try {
        const response = await fetch(config.versionManifestUrl, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
            log.info("version", `check failed: manifest fetch returned ${response.status}`);
            return;
        }
        const manifest = (await response.json()) as VersionManifest;

        let candidate = manifest.stable;
        if (
            Settings.get("checkBeta") === true &&
            parsesAsVersion(manifest.beta) &&
            parsesAsVersion(manifest.stable) &&
            isNewer(manifest.beta, manifest.stable)
        ) {
            candidate = manifest.beta;
        }
        if (!parsesAsVersion(candidate)) return;

        const changed = candidate !== latestVersion;
        latestVersion = candidate;
        if (changed) deps.onLatestVersionChanged?.();

        if (isNewer(candidate, VERSION) && Settings.get("autoUpgrade") === true) {
            deps.onAutoUpgrade?.(config);
        }
    } catch (error) {
        // Never fatal, and latestVersion is left exactly as it was: a transient network
        // failure must not make the UI briefly forget a version it already learned about.
        log.info("version", `check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** Runs `check` once immediately, then every 48 hours. Returns a function that stops the timer. */
export function startVersionCheck(config: Readonly<Config>, deps: VersionCheckDeps = {}): () => void {
    void check(config, deps);
    const timer = setInterval(() => void check(config, deps), CHECK_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
}
