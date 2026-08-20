import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { all, closeDatabase, one, openDatabase, run, tx } from "./index.ts";

async function withDatabase(fn: () => void): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), "docknight-db-"));
    try {
        const dataDir = join(root, "data");
        await mkdir(dataDir);
        const config = loadConfig(
            ["node", "index.ts", "--data-dir", dataDir, "--stacks-dir", join(root, "stacks")],
            {},
        );
        const db = openDatabase(config);
        db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT UNIQUE) STRICT");
        fn();
    } finally {
        closeDatabase();
        await rm(root, { recursive: true, force: true });
    }
}

test("pragmas are applied at open", async () => {
    await withDatabase(() => {
        const journalMode = one<{ journal_mode: string }>("PRAGMA journal_mode");
        assert.equal(journalMode?.journal_mode, "wal");
        const foreignKeys = one<{ foreign_keys: number }>("PRAGMA foreign_keys");
        assert.equal(foreignKeys?.foreign_keys, 1);
        const synchronous = one<{ synchronous: number }>("PRAGMA synchronous");
        assert.equal(synchronous?.synchronous, 1);
        const busyTimeout = one<{ timeout: number }>("PRAGMA busy_timeout");
        assert.equal(busyTimeout?.timeout, 5000);
    });
});

test("run, one, all round trip bound parameters", async () => {
    await withDatabase(() => {
        run("INSERT INTO t (name) VALUES (:name)", { name: "a" });
        run("INSERT INTO t (name) VALUES (:name)", { name: "b" });
        assert.equal(one<{ name: string }>("SELECT name FROM t WHERE id = :id", { id: 1 })?.name, "a");
        assert.equal(one("SELECT name FROM t WHERE id = :id", { id: 99 }), undefined);
        assert.equal(all<{ name: string }>("SELECT name FROM t").length, 2);
    });
});

test("tx commits on return and rolls back on throw", async () => {
    await withDatabase(() => {
        tx(() => {
            run("INSERT INTO t (name) VALUES (:name)", { name: "committed" });
        });
        assert.equal(all("SELECT * FROM t").length, 1);

        assert.throws(() => {
            tx(() => {
                run("INSERT INTO t (name) VALUES (:name)", { name: "rolled-back" });
                throw new Error("boom");
            });
        }, /boom/);
        assert.equal(all("SELECT * FROM t").length, 1);
    });
});

test("a constraint violation throws rather than being swallowed", async () => {
    await withDatabase(() => {
        run("INSERT INTO t (name) VALUES (:name)", { name: "dup" });
        assert.throws(() => run("INSERT INTO t (name) VALUES (:name)", { name: "dup" }));
    });
});
