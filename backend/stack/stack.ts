import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { parseDocument } from "yaml";
import { AppError } from "../../common/errors.ts";
import type { StackDetail } from "../../common/stack.ts";

export const COMPOSE_FILE_NAMES = [
    "compose.yaml",
    "docker-compose.yaml",
    "docker-compose.yml",
    "compose.yml",
];

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * Resolve a stack name to an absolute path inside the stacks directory. Applies the name
 * policy and then verifies containment independently, so the returned path is always safe to
 * pass to a destructive filesystem call even if the regex above is loosened later.
 *
 * @throws AppError("validation", ..., "invalidStackName") for any name that fails either check.
 */
export function resolveStackPath(stacksDir: string, name: string): string {
    if (!NAME_RE.test(name)) {
        throw new AppError("validation", `${name} is not a valid stack name`, "invalidStackName");
    }
    const full = resolve(stacksDir, name);
    if (full !== join(stacksDir, name)) {
        throw new AppError("validation", `${name} is not a valid stack name`, "invalidStackName");
    }
    const withSep = stacksDir.endsWith(sep) ? stacksDir : stacksDir + sep;
    if (!full.startsWith(withSep)) {
        throw new AppError("validation", `${name} is not a valid stack name`, "invalidStackName");
    }
    return full;
}

/** The first accepted compose file name present in `dir`, or null when none exists. */
export function probeComposeFileName(dir: string): string | null {
    for (const candidate of COMPOSE_FILE_NAMES) {
        if (existsSync(join(dir, candidate))) return candidate;
    }
    return null;
}

export interface ResolvedStack {
    name: string;
    dir: string;
    composeFileName: string;
}

/**
 * Resolve a name to a live stack directory on disk, independent of the registry's cached scan.
 * Used by write paths (deploy, save) where a stack created moments ago must be usable before
 * the next periodic scan picks it up.
 *
 * @throws AppError("notFound", ..., "stackNotFound") when the directory does not exist or has
 *         no recognised compose file.
 */
export function resolveExistingStack(stacksDir: string, name: string): ResolvedStack {
    const dir = resolveStackPath(stacksDir, name);
    const composeFileName = probeComposeFileName(dir);
    if (composeFileName === null) {
        throw new AppError("notFound", `no stack named ${name}`, "stackNotFound");
    }
    return { name, dir, composeFileName };
}

async function readCapped(path: string): Promise<string> {
    let size: number;
    try {
        size = statSync(path).size;
    } catch {
        return "";
    }
    if (size > MAX_FILE_BYTES) {
        throw new AppError("validation", `${path} exceeds the 1 MiB read cap`, "composeFileTooLarge");
    }
    return readFile(path, "utf8");
}

/**
 * Read one stack's files from disk. `primaryHostname` is left blank here; the caller fills it
 * in from settings, since this module has no dependency on the settings store.
 */
export async function readStack(stacksDir: string, name: string): Promise<StackDetail> {
    const dir = resolveStackPath(stacksDir, name);
    if (!existsSync(dir)) {
        throw new AppError("notFound", `no stack named ${name}`, "stackNotFound");
    }
    const fileName = probeComposeFileName(dir) ?? "compose.yaml";
    const composeYAML = await readCapped(join(dir, fileName));
    const composeENV = await readCapped(join(dir, ".env"));
    return {
        name,
        status: 0,
        managed: true,
        composeFileName: fileName,
        composeYAML,
        composeENV,
        primaryHostname: "",
    };
}

/** Validate env text against the same per-line rule used for a stack's own `.env`. */
export function validateEnvTextOnly(text: string): void {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] as string;
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) continue;
        if (!line.includes("=")) {
            throw new AppError(
                "validation",
                `line ${i + 1} is neither blank, a comment, nor KEY=value`,
                "invalidEnvFormat",
                { line: i + 1 },
            );
        }
    }
}

/**
 * Validate a stack name, its compose YAML, and its env text, without touching the filesystem.
 *
 * @throws AppError("validation", ...) with one of invalidStackName, invalidYAML,
 *         servicesMustBeObject, or invalidEnvFormat.
 */
export function validateStackFiles(
    stacksDir: string,
    name: string,
    composeYAML: string,
    composeENV: string,
): void {
    // Containment is irrelevant to file content validation, but the name policy still applies:
    // resolveStackPath is called for its name check even though its path is unused here.
    resolveStackPath(stacksDir, name);

    const doc = parseDocument(composeYAML);
    if (doc.errors.length > 0) {
        throw new AppError("validation", doc.errors[0]?.message ?? "invalid YAML", "invalidYAML");
    }
    const root: unknown = doc.toJS();
    if (typeof root !== "object" || root === null || Array.isArray(root)) {
        throw new AppError("validation", "the compose file must be a mapping", "invalidCompose");
    }
    const services = (root as Record<string, unknown>).services;
    if (services !== undefined && (typeof services !== "object" || services === null || Array.isArray(services))) {
        throw new AppError("validation", "services must be a mapping", "servicesMustBeObject");
    }

    validateEnvTextOnly(composeENV);
}
