import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { openSync, readFileSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import { internal } from "../../common/errors.ts";
import type { Config } from "../config.ts";
import { log } from "../log.ts";

const KEY_FILE_NAME = "agent-key";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = "v1";

let config: Readonly<Config> | null = null;
let cached: Buffer | null = null;

export function init(next: Readonly<Config>): void {
    config = next;
    cached = null;
}

function keyPath(): string {
    if (config === null) throw new Error("agent crypto is not initialised");
    return join(config.dataDir, KEY_FILE_NAME);
}

/**
 * The key material, created on first use with mode 0600 and O_EXCL. Losing the file means the
 * stored passwords cannot be decrypted; the recovery is to re-add the hosts.
 */
function key(): Buffer {
    if (cached !== null) return cached;
    const path = keyPath();
    try {
        const existing = readFileSync(path);
        if (existing.byteLength !== KEY_BYTES) {
            throw internal(`${KEY_FILE_NAME} is ${existing.byteLength} bytes, expected ${KEY_BYTES}`, {
                i18n: "agentKeyUnreadable",
            });
        }
        cached = existing;
        return existing;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const fresh = randomBytes(KEY_BYTES);
    try {
        const fd = openSync(path, "wx", 0o600);
        writeSync(fd, fresh);
        closeSync(fd);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            // Another writer won the race; read what it wrote.
            cached = readFileSync(path);
            return cached;
        }
        throw internal(`cannot create ${KEY_FILE_NAME}`, {
            i18n: "agentKeyUnreadable",
            cause: error,
        });
    }
    log.info("agent", `created ${KEY_FILE_NAME}`);
    cached = fresh;
    return fresh;
}

/** AES-256-GCM over the password, under the key file in the data directory. */
export function encryptSecret(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key(), iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64"), body.toString("base64"), tag.toString("base64")].join("$");
}

export function decryptSecret(stored: string): string {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== VERSION) {
        throw internal("a stored host credential is not in a readable format", {
            i18n: "agentKeyUnreadable",
        });
    }
    try {
        const decipher = createDecipheriv(
            "aes-256-gcm",
            key(),
            Buffer.from(parts[1] as string, "base64"),
        );
        decipher.setAuthTag(Buffer.from(parts[3] as string, "base64"));
        return Buffer.concat([
            decipher.update(Buffer.from(parts[2] as string, "base64")),
            decipher.final(),
        ]).toString("utf8");
    } catch (error) {
        throw internal("a stored host credential cannot be decrypted", {
            i18n: "agentKeyUnreadable",
            cause: error,
        });
    }
}
