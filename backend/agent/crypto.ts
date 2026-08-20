import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "../../common/errors.ts";

const KEY_FILE_NAME = "agent-key";
const KEY_BYTES = 32;

/**
 * Load the AES-256-GCM key from `${dataDir}/agent-key`, creating it with 32 random bytes and
 * mode 0600 on first use. `wx` (O_EXCL) on creation means a race between two processes never
 * clobbers a key one of them already wrote; the loser's write fails with EEXIST and it reads
 * back the file the winner created.
 *
 * @throws AppError("internal", ..., "agentKeyUnreadable") when the file exists but is not
 *         exactly 32 bytes.
 */
export async function loadOrCreateKey(dataDir: string): Promise<Buffer> {
    const path = join(dataDir, KEY_FILE_NAME);
    let key: Buffer;
    try {
        key = await readFile(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const generated = randomBytes(KEY_BYTES);
        try {
            await writeFile(path, generated, { mode: 0o600, flag: "wx" });
            return generated;
        } catch (writeError) {
            if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
            key = await readFile(path); // another process won the race; read what it wrote
        }
    }
    if (key.length !== KEY_BYTES) {
        throw new AppError(
            "internal",
            `${path} is not a valid ${KEY_BYTES}-byte key`,
            "agentKeyUnreadable",
        );
    }
    return key;
}

/** Encrypt one secret for storage: `v1$<iv>$<ciphertext>$<tag>`, each field base64. */
export function encryptSecret(key: Buffer, plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1$${iv.toString("base64")}$${ciphertext.toString("base64")}$${tag.toString("base64")}`;
}

/**
 * Decrypt a secret produced by encryptSecret.
 *
 * @throws AppError("internal", ..., "agentKeyUnreadable") when the stored value is malformed,
 *         or when the authentication tag does not verify (tampering or the wrong key).
 */
export function decryptSecret(key: Buffer, stored: string): string {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "v1") {
        throw new AppError("internal", "stored secret has an unrecognised format", "agentKeyUnreadable");
    }
    const [, ivB64, ciphertextB64, tagB64] = parts;
    try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64 as string, "base64"));
        decipher.setAuthTag(Buffer.from(tagB64 as string, "base64"));
        const plain = Buffer.concat([
            decipher.update(Buffer.from(ciphertextB64 as string, "base64")),
            decipher.final(),
        ]);
        return plain.toString("utf8");
    } catch {
        throw new AppError("internal", "stored secret failed to decrypt", "agentKeyUnreadable");
    }
}
