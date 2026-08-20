import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { MigrationError, runMigrations } from "./migrate.ts";

function freshDb(): DatabaseSync {
    return new DatabaseSync(":memory:");
}

const MIGRATION_BOOKKEEPING = `
    CREATE TABLE IF NOT EXISTS migration (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL
    ) STRICT;
`;

test("runMigrations applies 001-initial and records it", () => {
    const db = freshDb();
    runMigrations(db);

    const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
    assert.deepEqual(tables, ["agent", "migration", "session", "setting", "user"]);

    const applied = db.prepare("SELECT version, name FROM migration").all() as { version: number; name: string }[];
    assert.equal(applied.length, 1);
    assert.equal(applied[0]?.version, 1);
    assert.equal(applied[0]?.name, "initial");
});

test("running twice applies nothing the second time", () => {
    const db = freshDb();
    runMigrations(db);
    runMigrations(db);
    const applied = db.prepare("SELECT version FROM migration").all();
    assert.equal(applied.length, 1);
});

test("a migration that fails partway rolls back every statement it ran, in one transaction", () => {
    const db = freshDb();
    db.exec(MIGRATION_BOOKKEEPING);
    // Pre-create the last table 001-initial creates, so its up() fails after the earlier
    // CREATE TABLE statements already ran inside the same IMMEDIATE transaction.
    db.exec("CREATE TABLE agent (id INTEGER PRIMARY KEY) STRICT;");

    assert.throws(() => runMigrations(db), MigrationError);

    // DDL in SQLite is transactional: the tables created before the failing statement are
    // gone too, and no row for version 1 was left in the migration table.
    const leaked = db
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('setting', 'user', 'session')",
        )
        .all();
    assert.deepEqual(leaked, []);
    assert.equal(db.prepare("SELECT * FROM migration WHERE version = 1").get(), undefined);
});

test("MigrationError names the failed version and wraps the original error", () => {
    const db = freshDb();
    db.exec(MIGRATION_BOOKKEEPING);
    db.exec("CREATE TABLE agent (id INTEGER PRIMARY KEY) STRICT;");

    try {
        runMigrations(db);
        assert.fail("expected runMigrations to throw");
    } catch (error) {
        assert.ok(error instanceof MigrationError);
        assert.match(error.message, /001-initial/);
        assert.ok(error.cause instanceof Error);
    }
});

test("a version applied in the database but absent from the tree is logged and ignored", () => {
    const db = freshDb();
    db.exec(MIGRATION_BOOKKEEPING);
    db.prepare(
        "INSERT INTO migration(version, name, applied_at) VALUES (999, 'from-the-future', 0)",
    ).run();

    // Should not throw; 001-initial still applies normally alongside the unknown row.
    runMigrations(db);
    const versions = (
        db.prepare("SELECT version FROM migration ORDER BY version").all() as { version: number }[]
    ).map((row) => row.version);
    assert.deepEqual(versions, [1, 999]);
});
