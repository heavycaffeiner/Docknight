import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
    GLOBAL_ENV_FILE_NAME,
    GLOBAL_ENV_PLACEHOLDER,
    MAX_STACK_FILE_BYTES,
} from "../../common/stack.ts";
import { validation } from "../../common/errors.ts";
import type { Config } from "../config.ts";
import { applyOwnership } from "../directories.ts";
import { log } from "../log.ts";
import { validateEnv, writeAtomic } from "./stack.ts";

function path(config: Readonly<Config>): string {
    return join(config.stacksDir, GLOBAL_ENV_FILE_NAME);
}

/** An absent file reads as the placeholder, which is also how the user removes it. */
export async function readGlobalEnv(config: Readonly<Config>): Promise<string> {
    try {
        const content = await readFile(path(config), "utf8");
        if (content.length > MAX_STACK_FILE_BYTES) {
            throw validation(`${GLOBAL_ENV_FILE_NAME} exceeds ${MAX_STACK_FILE_BYTES} bytes`, {
                i18n: "composeFileTooLarge",
                values: { name: GLOBAL_ENV_FILE_NAME },
            });
        }
        return content;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return GLOBAL_ENV_PLACEHOLDER;
        throw error;
    }
}

export async function writeGlobalEnv(config: Readonly<Config>, content: string): Promise<void> {
    const target = path(config);
    if (content.trim() === GLOBAL_ENV_PLACEHOLDER || content.trim() === "") {
        await unlink(target).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
        });
        log.info("stacks", `${GLOBAL_ENV_FILE_NAME} removed`);
        return;
    }
    validateEnv(content, GLOBAL_ENV_FILE_NAME);
    await writeAtomic(target, content);
    await applyOwnership(config, target);
}
