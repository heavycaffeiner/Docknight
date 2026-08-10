import { constants } from "node:fs";
import { access, lstat, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { parseDocument } from "yaml";
import { conflict, notFound, validation } from "../../common/errors.ts";
import {
    COMPOSE_FILE_NAMES,
    DEFAULT_COMPOSE_FILE_NAME,
    DRAFT,
    MAX_STACK_FILE_BYTES,
    STACK_NAME_PATTERN,
    type StackDetail,
    type StackStatus,
} from "../../common/stack.ts";
import type { Config } from "../config.ts";
import { applyOwnership } from "../directories.ts";
import { log } from "../log.ts";

export interface Stack {
    name: string;
    dir: string;
    composeFileName: string;
}

export function assertValidName(name: string): void {
    if (!STACK_NAME_PATTERN.test(name)) {
        throw validation(`stack name ${JSON.stringify(name)} is not acceptable`, {
            i18n: "invalidStackName",
            values: { name },
        });
    }
}

/**
 * Resolve a stack name to an absolute path inside the stacks directory. The regex is the policy;
 * the containment check is the guarantee that a destructive call relies on, so it is not
 * conditional on the policy staying as strict as it is today.
 */
export function resolveStackPath(stacksDir: string, name: string): string {
    assertValidName(name);
    const full = resolve(stacksDir, name);
    if (full !== join(stacksDir, name) || !full.startsWith(stacksDir + sep)) {
        throw validation(`stack name ${JSON.stringify(name)} resolves outside the stacks directory`, {
            i18n: "invalidStackName",
            values: { name },
        });
    }
    return full;
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/** The first accepted compose file name present in the directory, or null. */
export async function probeComposeFileName(dir: string): Promise<string | null> {
    for (const candidate of COMPOSE_FILE_NAMES) {
        if (await exists(join(dir, candidate))) return candidate;
    }
    return null;
}

export async function locate(config: Readonly<Config>, name: string): Promise<Stack> {
    const dir = resolveStackPath(config.stacksDir, name);
    if (!(await exists(dir))) {
        throw notFound(`stack ${name} has no directory`, {
            i18n: "stackNotFound",
            values: { name },
        });
    }
    const composeFileName = (await probeComposeFileName(dir)) ?? DEFAULT_COMPOSE_FILE_NAME;
    return { name, dir, composeFileName };
}

async function readCapped(path: string, name: string): Promise<string> {
    let info;
    try {
        info = await stat(path);
    } catch {
        return "";
    }
    if (info.size > MAX_STACK_FILE_BYTES) {
        throw validation(`${name} exceeds ${MAX_STACK_FILE_BYTES} bytes`, {
            i18n: "composeFileTooLarge",
            values: { name },
        });
    }
    return await readFile(path, "utf8");
}

export async function read(
    config: Readonly<Config>,
    name: string,
    primaryHostname: string,
    status: StackStatus = DRAFT,
): Promise<StackDetail> {
    const stack = await locate(config, name);
    const composeYAML = await readCapped(join(stack.dir, stack.composeFileName), stack.composeFileName);
    const composeENV = await readCapped(join(stack.dir, ".env"), ".env");
    return {
        name,
        status,
        managed: true,
        composeFileName: stack.composeFileName,
        composeYAML,
        composeENV,
        primaryHostname,
    };
}

/**
 * Reject an env buffer that `docker compose` would fail on with an opaque platform error. A
 * line-numbered message is the difference between a five second fix and a support thread.
 */
export function validateEnv(text: string, label: string): void {
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) continue;
        if (!trimmed.includes("=")) {
            throw validation(`${label} line ${index + 1} is neither blank, a comment, nor KEY=value`, {
                i18n: "invalidEnvFormat",
                values: { line: index + 1, file: label },
            });
        }
    }
}

export function validateCompose(composeYAML: string): void {
    const doc = parseDocument(composeYAML);
    if (doc.errors.length > 0) {
        const first = doc.errors[0];
        throw validation(first?.message ?? "compose file does not parse", {
            i18n: "invalidYAML",
            values: { detail: first?.message ?? "" },
        });
    }
    const root: unknown = doc.toJS();
    if (root === null || typeof root !== "object" || Array.isArray(root)) {
        throw validation("the compose file root must be a mapping", { i18n: "invalidCompose" });
    }
    const services = (root as { services?: unknown }).services;
    if (services !== undefined && services !== null) {
        if (typeof services !== "object" || Array.isArray(services)) {
            throw validation("services must be a mapping", { i18n: "servicesMustBeObject" });
        }
    }
}

/** The service names declared in a compose buffer, used by the exec service check. */
export function serviceNames(composeYAML: string): string[] {
    const doc = parseDocument(composeYAML);
    if (doc.errors.length > 0) return [];
    const root: unknown = doc.toJS();
    if (root === null || typeof root !== "object") return [];
    const services = (root as { services?: unknown }).services;
    if (services === null || typeof services !== "object" || Array.isArray(services)) return [];
    return Object.keys(services as Record<string, unknown>);
}

/**
 * Write `content` to `target` atomically: same-directory temp file, fsync, rename, directory
 * fsync. On any failure the temp file is removed and the original is untouched.
 */
export async function writeAtomic(target: string, content: string, mode = 0o644): Promise<void> {
    const tmp = `${target}.tmp-${randomBytes(3).toString("hex")}`;
    let handle;
    try {
        handle = await open(tmp, "wx", mode);
        await handle.writeFile(content, "utf8");
        await handle.sync();
    } catch (error) {
        await handle?.close().catch(() => undefined);
        await unlink(tmp).catch(() => undefined);
        throw error;
    }
    await handle.close();

    try {
        await rename(tmp, target);
    } catch (error) {
        await unlink(tmp).catch(() => undefined);
        throw error;
    }

    // Makes the rename itself durable.
    try {
        const dir = await open(dirname(target), "r");
        await dir.sync();
        await dir.close();
    } catch (error) {
        log.debug("stack", `directory fsync for ${target} skipped`, error);
    }
}

export interface WriteResult {
    stack: Stack;
    created: boolean;
}

export async function write(
    config: Readonly<Config>,
    name: string,
    composeYAML: string,
    composeENV: string,
    isCreate: boolean,
): Promise<WriteResult> {
    const dir = resolveStackPath(config.stacksDir, name);
    const present = await exists(dir);

    if (isCreate) {
        if (present) {
            throw conflict(`stack ${name} already exists`, {
                i18n: "stackAlreadyExists",
                values: { name },
            });
        }
        await mkdir(dir, { recursive: true, mode: 0o755 });
        await applyOwnership(config, dir);
    } else if (!present) {
        throw notFound(`stack ${name} has no directory`, {
            i18n: "stackNotFound",
            values: { name },
        });
    }

    const composeFileName = (await probeComposeFileName(dir)) ?? DEFAULT_COMPOSE_FILE_NAME;
    const composeFilePath = join(dir, composeFileName);
    await writeAtomic(composeFilePath, composeYAML);
    await applyOwnership(config, composeFilePath);

    const envPath = join(dir, ".env");
    // Written whenever the user supplied content or a .env already exists, so an edit in the
    // environment editor is never silently discarded.
    if (composeENV !== "" || (await exists(envPath))) {
        await writeAtomic(envPath, composeENV);
        await applyOwnership(config, envPath);
    }

    return { stack: { name, dir, composeFileName }, created: isCreate };
}

/**
 * Verify with lstat that the target is a directory and not a symbolic link, so a symlink planted
 * inside the stacks directory cannot redirect a removal.
 */
export async function assertRemovableDirectory(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
        throw validation(`${path} is a symbolic link and will not be removed`, {
            i18n: "invalidStackName",
        });
    }
    if (!info.isDirectory()) {
        throw validation(`${path} is not a directory`, { i18n: "invalidStackName" });
    }
}
