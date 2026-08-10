import { readFile } from "node:fs/promises";
import { GENERAL_SETTINGS_DEFAULTS } from "../common/protocol.ts";
import type { Config } from "./config.ts";
import { log } from "./log.ts";
import * as settings from "./settings.ts";
import { isRunning, startUpgrade } from "./upgrade.ts";

const MANIFEST_URL =
    process.env.DOCKNIGHT_VERSION_MANIFEST_URL ??
    "https://raw.githubusercontent.com/heavycaffeiner/Docknight/main/version.json";

const CHECK_INTERVAL_MS = 48 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

let currentVersion = "0.0.0";
/** Process state, not a database row. Starts undefined so a fresh process reports nothing. */
let latest: string | undefined;
let timer: NodeJS.Timeout | null = null;

export async function loadVersion(packageJsonPath: string): Promise<string> {
    try {
        const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown };
        if (typeof manifest.version === "string") currentVersion = manifest.version;
    } catch (error) {
        log.warn("version", "cannot read package.json, reporting 0.0.0", error);
    }
    return currentVersion;
}

export function version(): string {
    return currentVersion;
}

export function latestVersion(): string | undefined {
    return latest;
}

function compare(a: string, b: string): number {
    const parse = (value: string): number[] =>
        (value.split("-")[0] ?? "").split(".").map((part) => Number(part) || 0);
    const left = parse(a);
    const right = parse(b);
    for (let index = 0; index < 3; index += 1) {
        const delta = (left[index] ?? 0) - (right[index] ?? 0);
        if (delta !== 0) return delta;
    }
    // A prerelease sorts below the release it precedes.
    const leftPre = a.includes("-");
    const rightPre = b.includes("-");
    if (leftPre === rightPre) return 0;
    return leftPre ? -1 : 1;
}

interface Manifest {
    stable?: unknown;
    beta?: unknown;
}

function autoUpgrade(config: Readonly<Config>): void {
    if (!settings.get("autoUpgrade", GENERAL_SETTINGS_DEFAULTS.autoUpgrade)) return;
    if (isRunning()) return;
    log.info("version", `${latest} is newer than ${currentVersion}, upgrading`);
    void startUpgrade(config, null).catch((error: unknown) => {
        log.info("version", "auto upgrade is not available here", error);
    });
}

async function check(config: Readonly<Config>): Promise<void> {
    // The check performs no request at all while checkUpdate is false, which is what makes the
    // setting meaningful to an operator who does not want the process reaching the network.
    if (!settings.get("checkUpdate", GENERAL_SETTINGS_DEFAULTS.checkUpdate)) return;

    try {
        const response = await fetch(MANIFEST_URL, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { accept: "application/json" },
        });
        if (!response.ok) {
            log.info("version", `manifest fetch returned ${response.status}`);
            return;
        }
        const manifest = (await response.json()) as Manifest;
        const stable = typeof manifest.stable === "string" ? manifest.stable : undefined;
        const beta = typeof manifest.beta === "string" ? manifest.beta : undefined;

        let candidate = stable;
        if (
            settings.get("checkBeta", GENERAL_SETTINGS_DEFAULTS.checkBeta) &&
            beta !== undefined &&
            (stable === undefined || compare(beta, stable) > 0)
        ) {
            candidate = beta;
        }
        if (candidate !== undefined && VERSION_PATTERN.test(candidate)) {
            latest = candidate;
            log.debug("version", `latest available is ${candidate}`);
            if (compare(candidate, currentVersion) > 0) autoUpgrade(config);
        }
    } catch (error) {
        // Never fatal, and latestVersion is left unchanged.
        log.info("version", "update check did not complete", error);
    }
}

export function startVersionCheck(config: Readonly<Config>): void {
    if (timer !== null) return;
    void check(config);
    timer = setInterval(() => void check(config), CHECK_INTERVAL_MS);
    timer.unref();
}

export function stopVersionCheck(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
}
