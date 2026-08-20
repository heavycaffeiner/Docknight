import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { run } from "../db/index.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DIGITS = 6;
const STEP_SECONDS = 30;
const SECRET_BYTES = 20;

/** RFC 4648 base32 without padding. */
export function base32Encode(bytes: Uint8Array): string {
    let out = "";
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += ALPHABET[(buffer >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
    return out;
}

export function base32Decode(text: string): Buffer {
    const clean = text.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
    const bytes: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (const char of clean) {
        const index = ALPHABET.indexOf(char);
        if (index < 0) throw new Error(`base32: unexpected character ${JSON.stringify(char)}`);
        buffer = (buffer << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bytes.push((buffer >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

/** 20 random bytes, base32 encoded without padding. */
export function generateSecret(): string {
    return base32Encode(randomBytes(SECRET_BYTES));
}

/** RFC 6238 with the parameters every authenticator app defaults to: HMAC-SHA1, 6 digits, 30 s. */
export function generateCode(secret: Buffer, step: number): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const mac = createHmac("sha1", secret).update(counter).digest();
    const offset = (mac[19] as number) & 0x0f;
    const binary =
        (((mac[offset] as number) & 0x7f) << 24) |
        (((mac[offset + 1] as number) & 0xff) << 16) |
        (((mac[offset + 2] as number) & 0xff) << 8) |
        ((mac[offset + 3] as number) & 0xff);
    return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function currentStep(nowMs: number = Date.now()): number {
    return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

export interface TotpCheck {
    /** The step whose code matched, or null when none did. */
    step: number | null;
}

/**
 * Verify a code across steps [now-1, now, now+1], rejecting any step at or below `lastStep`.
 * Pure: makes no database access, so RFC test vectors drive it directly. Recording the accepted
 * counter, rather than the accepted digits, is what makes the replay guard hold across a secret
 * change: a code cannot be reused inside its own window.
 */
export function checkCode(
    secretBase32: string,
    code: string,
    lastStep: number | null,
    nowMs: number = Date.now(),
): TotpCheck {
    if (!/^[0-9]{6}$/.test(code)) return { step: null };

    let secret: Buffer;
    try {
        secret = base32Decode(secretBase32);
    } catch {
        return { step: null };
    }
    if (secret.byteLength === 0) return { step: null };

    const now = currentStep(nowMs);
    const supplied = Buffer.from(code, "utf8");
    for (const step of [now - 1, now, now + 1]) {
        if (lastStep !== null && step <= lastStep) continue;
        const expected = Buffer.from(generateCode(secret, step), "utf8");
        if (expected.byteLength === supplied.byteLength && timingSafeEqual(expected, supplied)) {
            return { step };
        }
    }
    return { step: null };
}

/** The minimal user shape TOTP verification needs; any row with these columns satisfies it. */
export interface TotpUser {
    id: number;
    totp_secret: string | null;
    totp_last_step: number | null;
}

/**
 * Verify a 6-digit code against the user's secret across steps [now-1, now, now+1], rejecting
 * any step already recorded in totp_last_step, and recording the accepted step on success.
 */
export function verifyTotp(user: TotpUser, code: string): boolean {
    if (user.totp_secret === null) return false;
    const result = checkCode(user.totp_secret, code, user.totp_last_step);
    if (result.step === null) return false;
    run("UPDATE user SET totp_last_step = :step WHERE id = :id", { step: result.step, id: user.id });
    return true;
}

/** The otpauth URI an authenticator app scans to enrol the secret. */
export function provisioningUri(username: string, secretBase32: string): string {
    const label = encodeURIComponent(`Docknight:${username}`);
    const params = new URLSearchParams({
        secret: secretBase32,
        issuer: "Docknight",
        algorithm: "SHA1",
        digits: String(DIGITS),
        period: String(STEP_SECONDS),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
}
