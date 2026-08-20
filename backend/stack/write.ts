import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError } from "../../common/errors.ts";
import { applyOwnership } from "../directories.ts";
import type { Config } from "../config.ts";
import { probeComposeFileName, resolveStackPath } from "./stack.ts";

/**
 * Write `content` to `target` atomically: a same-directory temp file, fsync, rename, and a
 * directory fsync to make the rename itself durable. On any failure the temp file is removed
 * and the original file at `target` is left untouched.
 */
export async function writeAtomic(target: string, content: string, mode = 0o644): Promise<void> {
    const tmp = `${target}.tmp-${randomBytes(3).toString("hex")}`;
    const handle = await open(tmp, "wx", mode);
    try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    try {
        await rename(tmp, target);
    } catch (error) {
        await unlink(tmp).catch(() => undefined);
        throw error;
    }
    const dirHandle = await open(dirname(target), "r");
    try {
        await dirHandle.sync();
    } finally {
        await dirHandle.close();
    }
}

/**
 * Create or update one stack's files. Creation makes the directory; an update requires it to
 * already exist. `.env` is written whenever the caller supplied non-empty content or a `.env`
 * already exists on disk, so an edit is never silently discarded.
 */
export async function writeStack(
    config: Readonly<Config>,
    name: string,
    composeYAML: string,
    composeENV: string,
    isCreate: boolean,
): Promise<void> {
    const dir = resolveStackPath(config.stacksDir, name);
    if (isCreate) {
        if (existsSync(dir)) {
            throw new AppError("conflict", `a stack named ${name} already exists`, "stackAlreadyExists");
        }
        await mkdir(dir, { mode: 0o755 });
        await applyOwnership(config, dir);
    } else if (!existsSync(dir)) {
        throw new AppError("notFound", `no stack named ${name}`, "stackNotFound");
    }

    const fileName = probeComposeFileName(dir) ?? "compose.yaml";
    const composePath = join(dir, fileName);
    await writeAtomic(composePath, composeYAML);
    await applyOwnership(config, composePath);

    const envPath = join(dir, ".env");
    if (composeENV !== "" || existsSync(envPath)) {
        await writeAtomic(envPath, composeENV);
        await applyOwnership(config, envPath);
    }
}
