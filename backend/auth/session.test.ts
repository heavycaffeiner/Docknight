import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { closeDatabase, one, openDatabase, run } from "../db/index.ts";
import { runMigrations } from "../db/migrate.ts";
import {
    mintSession,
    resolveSession,
    revokeAllSessions,
    revokeSession,
    startSessionSweep,
} from "./session.ts";

async function withDatabase(fn: (adminId: number, secondId: number) => void): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), "docknight-session-"));
    try {
        const dataDir = join(root, "data");
        await mkdir(dataDir);
        const config = loadConfig(
            ["node", "index.ts", "--data-dir", dataDir, "--stacks-dir", join(root, "stacks")],
            {},
        );
        const db = openDatabase(config);
        runMigrations(db);
        const admin = run("INSERT INTO user (username, password_hash) VALUES ('admin', 'x')");
        const second = run("INSERT INTO user (username, password_hash) VALUES ('second', 'y')");
        fn(admin.lastInsertRowid, second.lastInsertRowid);
    } finally {
        closeDatabase();
        await rm(root, { recursive: true, force: true });
    }
}

test("mintSession returns a usable token that resolveSession can find", async () => {
    await withDatabase((adminId) => {
        const { token, sessionId } = mintSession(adminId);
        assert.ok(token.length > 20);
        const resolved = resolveSession(token);
        assert.deepEqual(resolved, { userId: adminId, sessionId });
    });
});

test("an unknown token resolves to null", async () => {
    await withDatabase(() => {
        assert.equal(resolveSession("not-a-real-token"), null);
    });
});

test("an expired session is deleted on resolution and resolves to null", async () => {
    await withDatabase((adminId) => {
        const { token, sessionId } = mintSession(adminId);
        run("UPDATE session SET expires_at = 0 WHERE id = :id", { id: sessionId });
        assert.equal(resolveSession(token), null);
        assert.equal(one("SELECT id FROM session WHERE id = :id", { id: sessionId }), undefined);
    });
});

test("resolveSession slides the expiry forward on each successful resolution", async () => {
    await withDatabase((adminId) => {
        const { token, sessionId } = mintSession(adminId);
        const soon = Math.floor(Date.now() / 1000) + 60; // still valid, but far short of 30 days
        run("UPDATE session SET expires_at = :soon WHERE id = :id", { soon, id: sessionId });
        resolveSession(token);
        const row = one<{ expires_at: number }>("SELECT expires_at FROM session WHERE id = :id", {
            id: sessionId,
        });
        assert.ok(row !== undefined);
        // The new expiry is roughly now + 30 days, far past the stale near-term value.
        assert.ok((row?.expires_at ?? 0) > Math.floor(Date.now() / 1000) + 29 * 86400);
    });
});

test("revokeSession removes exactly that session", async () => {
    await withDatabase((adminId) => {
        const first = mintSession(adminId);
        const second = mintSession(adminId);
        revokeSession(first.sessionId);
        assert.equal(resolveSession(first.token), null);
        assert.notEqual(resolveSession(second.token), null);
    });
});

test("revokeAllSessions removes every session for that user only", async () => {
    await withDatabase((adminId, secondId) => {
        const mineA = mintSession(secondId);
        const mineB = mintSession(secondId);
        const other = mintSession(adminId);
        revokeAllSessions(secondId);
        assert.equal(resolveSession(mineA.token), null);
        assert.equal(resolveSession(mineB.token), null);
        assert.notEqual(resolveSession(other.token), null);
    });
});

test("startSessionSweep removes expired rows at startup", async () => {
    await withDatabase((adminId) => {
        const { sessionId } = mintSession(adminId);
        run("UPDATE session SET expires_at = 0 WHERE id = :id", { id: sessionId });
        const stop = startSessionSweep();
        stop();
        assert.equal(one("SELECT id FROM session WHERE id = :id", { id: sessionId }), undefined);
    });
});
