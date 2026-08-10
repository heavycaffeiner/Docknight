import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DIGITS = 6;
export const STEP_SECONDS = 30;
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
 * Recording the accepted counter, rather than the accepted digits, is what makes the replay
 * guard hold across a secret change.
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

/** The otpauth URI an authenticator app scans. */
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
