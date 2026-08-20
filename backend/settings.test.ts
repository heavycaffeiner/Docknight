import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { closeDatabase, one, openDatabase, run } from "./db/index.ts";
import { runMigrations } from "./db/migrate.ts";
import { Settings, startSettingsCacheSweeper } from "./settings.ts";

async function withDatabase(fn: () => void): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), "docknight-settings-"));
    try {
        const dataDir = join(root, "data");
        await mkdir(dataDir);
        const config = loadConfig(
            ["node", "index.ts", "--data-dir", dataDir, "--stacks-dir", join(root, "stacks")],
            {},
        );
        const db = openDatabase(config);
        runMigrations(db);
        fn();
    } finally {
        closeDatabase();
        await rm(root, { recursive: true, force: true });
    }
}

test("get returns undefined for an absent key", async () => {
    await withDatabase(() => {
        assert.equal(Settings.get("nope"), undefined);
    });
});

test("set then get round trips a JSON value, preserving its type", async () => {
    await withDatabase(() => {
        Settings.set("flag", true, "general");
        assert.equal(Settings.get("flag"), true);
        Settings.set("count", 42, "general");
        assert.equal(Settings.get("count"), 42);
        Settings.set("label", "hello", "general");
        assert.equal(Settings.get("label"), "hello");
    });
});

test("set is a cache hit within the TTL: the row is not re-read from the database", async () => {
    await withDatabase(() => {
        Settings.set("k", "first", "general");
        assert.equal(Settings.get("k"), "first");
        // Bypass Settings.set to simulate an external write; the cached value should still win.
        run("UPDATE setting SET value = :value WHERE key = :key", { value: JSON.stringify("second"), key: "k" });
        assert.equal(Settings.get("k"), "first");
    });
});

test("getGroup returns every key of that type, ignoring other groups", async () => {
    await withDatabase(() => {
        Settings.set("a", 1, "general");
        Settings.set("b", 2, "general");
        Settings.set("c", 3, "other");
        assert.deepEqual(Settings.getGroup("general"), { a: 1, b: 2 });
    });
});

test("setGroup writes every key in one transaction and invalidates their cache entries", async () => {
    await withDatabase(() => {
        Settings.setGroup("general", { x: 1, y: "two" });
        assert.equal(Settings.get("x"), 1);
        assert.equal(Settings.get("y"), "two");
        assert.deepEqual(Settings.getGroup("general"), { x: 1, y: "two" });
    });
});

test("setGroup cannot capture a row that already belongs to another type", async () => {
    await withDatabase(() => {
        Settings.set("shared", "internal-value", "internal");
        Settings.setGroup("general", { shared: "attempted-overwrite" });
        // The row keeps its original type and value; the write was skipped, not merged.
        const row = one<{ value: string; type: string }>("SELECT value, type FROM setting WHERE key = 'shared'");
        assert.equal(row?.type, "internal");
        assert.equal(JSON.parse(row?.value ?? "null"), "internal-value");
    });
});

test("the cache sweeper evicts stale entries and stop() clears everything", async () => {
    await withDatabase(() => {
        mock.timers.enable({ apis: ["Date", "setInterval"] });
        try {
            Settings.set("k", "v", "general");
            assert.equal(Settings.get("k"), "v"); // now cached

            const stop = startSettingsCacheSweeper();
            mock.timers.tick(60_001); // past the 60 s TTL: the sweeper interval fires once

            // Change the underlying row directly; a swept cache must re-read it.
            run("UPDATE setting SET value = :value WHERE key = 'k'", { value: JSON.stringify("changed") });
            assert.equal(Settings.get("k"), "changed");

            stop();
        } finally {
            mock.timers.reset();
        }
    });
});
