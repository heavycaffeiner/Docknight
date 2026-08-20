import { chown, lstat, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { log } from "./log.ts";

export class DataDirError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DataDirError";
    }
}

const PROBE_NAME = ".write-probe";

async function prepare(path: string, label: string): Promise<void> {
    try {
        await mkdir(path, { recursive: true });
    } catch (error) {
        throw new DataDirError(
            `${label}: cannot create ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    let stat;
    try {
        stat = await lstat(path);
    } catch (error) {
        throw new DataDirError(
            `${label}: cannot stat ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (!stat.isDirectory()) {
        throw new DataDirError(`${label}: ${path} exists and is not a directory`);
    }

    // A read-only bind mount is the most common deployment mistake and a later SQLite error
    // does not name the cause.
    const probe = join(path, PROBE_NAME);
    try {
        await writeFile(probe, "docknight");
        await unlink(probe);
    } catch (error) {
        throw new DataDirError(
            `${label}: ${path} is not writable: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

/** Create and validate both directories before anything else touches them. */
export async function prepareDirectories(config: Readonly<Config>): Promise<void> {
    await prepare(config.dataDir, "dataDir");
    await prepare(config.stacksDir, "stacksDir");
    log.debug("directories", `dataDir ${config.dataDir}, stacksDir ${config.stacksDir}`);
}

/**
 * Give a path the configured uid and gid, so a compose file written by a root-run container
 * stays editable by the host user. A no-op unless both PUID and PGID are set.
 */
export async function applyOwnership(config: Readonly<Config>, path: string): Promise<void> {
    if (config.puid === undefined || config.pgid === undefined) return;
    try {
        await chown(path, config.puid, config.pgid);
    } catch (error) {
        log.warn("directories", `chown ${path} failed`, error);
    }
}
