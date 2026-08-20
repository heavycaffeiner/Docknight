import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PREFIX = "scrypt";
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAXMEM = 64 * 1024 * 1024;

/**
 * Derive a self-describing scrypt hash. Input is NFKC normalised before derivation, so a
 * password typed on a different keyboard layout still matches.
 */
export function hashPassword(plain: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const key = scryptSync(plain.normalize("NFKC"), salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
    return [PREFIX, N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/**
 * Verify a password against a stored hash. Constant-time on the key comparison; returns false
 * rather than throwing for an unparseable stored value.
 */
export function verifyPassword(plain: string, stored: string): boolean {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== PREFIX) return false;

    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    if (n < 2 || (n & (n - 1)) !== 0) return false;

    let salt: Buffer;
    let expected: Buffer;
    try {
        salt = Buffer.from(parts[4] as string, "base64");
        expected = Buffer.from(parts[5] as string, "base64");
    } catch {
        return false;
    }
    if (salt.byteLength === 0 || expected.byteLength === 0) return false;

    let actual: Buffer;
    try {
        actual = scryptSync(plain.normalize("NFKC"), salt, expected.byteLength, { N: n, r, p, maxmem: MAXMEM });
    } catch {
        return false;
    }
    if (actual.byteLength !== expected.byteLength) return false;
    return timingSafeEqual(actual, expected);
}

/**
 * A hash to verify against when the username is unknown, computed once at module load, so a
 * login handler can run the same scrypt derivation on every path and response time reveals
 * nothing about whether the username exists.
 */
export const DUMMY_HASH = hashPassword("docknight-dummy");

/**
 * Reject weak passwords: at least 8 characters and at least two of letters, digits, symbols.
 * Returns null when acceptable, otherwise an i18n key.
 */
export function checkPasswordStrength(plain: string): string | null {
    if (plain.length < 8) return "passwordTooWeak";
    const classes = [/\p{L}/u, /\p{Nd}/u, /[^\p{L}\p{Nd}]/u].filter((re) => re.test(plain)).length;
    return classes >= 2 ? null : "passwordTooWeak";
}
