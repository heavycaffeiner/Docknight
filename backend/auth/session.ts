import { createHash, randomBytes } from "node:crypto";
import { one, run } from "../db/index.ts";
import { log } from "../log.ts";

const THIRTY_DAYS_SECONDS = 30 * 86400;
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
 * Mint an opaque 256-bit session token. Only the SHA-256 of the token is persisted.
 * Returns the token, shown to the client exactly once, and the row id, which the
 * connection keeps so that logout can revoke precisely this session.
 */
export function mintSession(userId: number): { token: string; sessionId: number } {
    const token = randomBytes(32).toString("base64url");
    const now = nowSeconds();
    const result = run(
        `INSERT INTO session (user_id, token_hash, created_at, last_used_at, expires_at)
         VALUES (:userId, :hash, :now, :now, :expires)`,
        { userId, hash: hashToken(token), now, expires: now + THIRTY_DAYS_SECONDS },
    );
    // invariant: the raw token exists only in this return value; never stored, never logged
    return { token, sessionId: result.lastInsertRowid };
}

/** Resolve and refresh a session token. Returns null when unknown or expired. */
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
        expires: now + THIRTY_DAYS_SECONDS,
        id: row.id,
    });
    return { userId: row.user_id, sessionId: row.id };
}

export function revokeSession(sessionId: number): void {
    run("DELETE FROM session WHERE id = :id", { id: sessionId });
}

export function revokeAllSessions(userId: number): void {
    run("DELETE FROM session WHERE user_id = :userId", { userId });
}

function sweep(): void {
    const result = run("DELETE FROM session WHERE expires_at <= :now", { now: nowSeconds() });
    if (result.changes > 0) log.debug("session", `swept ${result.changes} expired sessions`);
}

/** Sweep now, then every 6 hours. Returns a stop function, wired into shutdown. */
export function startSessionSweep(): () => void {
    sweep();
    const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
}
