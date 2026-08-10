import { createHash, randomBytes } from "node:crypto";
import { one, run } from "../db/index.ts";
import { log } from "../log.ts";

const LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface SessionRow {
    id: number;
    user_id: number;
    token_hash: string;
    created_at: number;
    last_used_at: number;
    expires_at: number;
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

function hashToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Mint an opaque 256-bit session token. Only the SHA-256 of the token is persisted. Returns the
 * token, which is shown to the client exactly once, and the row id, which the connection keeps
 * so logout can revoke precisely this session.
 */
export function mintSession(userId: number): { token: string; sessionId: number } {
    const token = randomBytes(32).toString("base64url");
    const now = nowSeconds();
    const result = run(
        `INSERT INTO session(user_id, token_hash, created_at, last_used_at, expires_at)
         VALUES (:userId, :hash, :now, :now, :expires)`,
        { userId, hash: hashToken(token), now, expires: now + LIFETIME_SECONDS },
    );
    return { token, sessionId: result.lastInsertRowid };
}

/**
 * Resolve and refresh a session token. Returns null when unknown or expired. The lookup is by
 * hash and therefore an exact index match, so no timing comparison is needed.
 */
export function resolveSession(token: string): { userId: number; sessionId: number } | null {
    const row = one<SessionRow>("SELECT * FROM session WHERE token_hash = :hash", {
        hash: hashToken(token),
    });
    if (row === undefined) return null;

    const now = nowSeconds();
    if (row.expires_at <= now) {
        run("DELETE FROM session WHERE id = :id", { id: row.id });
        return null;
    }

    run("UPDATE session SET last_used_at = :now, expires_at = :expires WHERE id = :id", {
        now,
        expires: now + LIFETIME_SECONDS,
        id: row.id,
    });
    return { userId: row.user_id, sessionId: row.id };
}

export function revokeSession(sessionId: number): void {
    run("DELETE FROM session WHERE id = :id", { id: sessionId });
}

export function revokeAllForUser(userId: number): void {
    run("DELETE FROM session WHERE user_id = :userId", { userId });
}

export function sweepExpired(): number {
    const result = run("DELETE FROM session WHERE expires_at <= :now", { now: nowSeconds() });
    if (result.changes > 0) log.debug("session", `swept ${result.changes} expired sessions`);
    return result.changes;
}

let sweeper: NodeJS.Timeout | null = null;

export function startSweeper(): void {
    if (sweeper !== null) return;
    sweepExpired();
    sweeper = setInterval(sweepExpired, SWEEP_INTERVAL_MS);
    sweeper.unref();
}

export function stopSweeper(): void {
    if (sweeper !== null) clearInterval(sweeper);
    sweeper = null;
}
