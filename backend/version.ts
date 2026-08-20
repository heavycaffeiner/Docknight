import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface PackageManifest {
    version: string;
}

const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as PackageManifest;

/** The running application version, read once from package.json at module load. */
export const VERSION = manifest.version;

/**
 * Set by the version check timer (phase 11). Starts undefined, so a fresh process reports
 * nothing in the `info` event until the first check completes.
 */
let latestVersion: string | undefined;

export function getLatestVersion(): string | undefined {
    return latestVersion;
}

export function setLatestVersion(next: string | undefined): void {
    latestVersion = next;
}
