import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { applyOwnership } from "../directories.ts";
import { validateEnvTextOnly } from "./stack.ts";
import { writeAtomic } from "./write.ts";

const PLACEHOLDER = "# VARIABLE=value #comment";

/** Read `${stacksDir}/global.env`, or the placeholder text when the file does not exist. */
export async function readGlobalEnv(config: Readonly<Config>): Promise<string> {
    const path = join(config.stacksDir, "global.env");
    if (!existsSync(path)) return PLACEHOLDER;
    return readFile(path, "utf8");
}

/**
 * Validate and write `${stacksDir}/global.env`. Writing content equal to the placeholder
 * deletes the file, so a user who never touched the field never creates one.
 */
export async function writeGlobalEnv(config: Readonly<Config>, content: string): Promise<void> {
    validateEnvTextOnly(content);
    const path = join(config.stacksDir, "global.env");
    if (content.trim() === PLACEHOLDER) {
        if (existsSync(path)) await unlink(path);
        return;
    }
    await writeAtomic(path, content);
    await applyOwnership(config, path);
}
