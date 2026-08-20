import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { closeDatabase, openDatabase } from "../db/index.ts";
import { runMigrations } from "../db/migrate.ts";
import { agentStore, deriveEndpoint, normaliseUrl } from "./store.ts";

async function withDatabase(fn: () => void): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), "docknight-agent-store-"));
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

test("normaliseUrl: scheme lowercased, default port dropped, trailing slash dropped", () => {
    assert.equal(normaliseUrl("HTTP://example.com:80/"), "http://example.com");
    assert.equal(normaliseUrl("https://example.com:443/"), "https://example.com");
    assert.equal(normaliseUrl("http://example.com:8080/path/"), "http://example.com:8080/path");
    assert.equal(normaliseUrl("http://example.com/path?x=1#h"), "http://example.com/path");
});

test("normaliseUrl rejects a string that does not parse as a URL", () => {
    assert.throws(
        () => normaliseUrl("not a url"),
        (error: unknown) => error instanceof Error && error.message.includes("valid URL"),
    );
});

test("normaliseUrl rejects a non-http(s) scheme", () => {
    assert.throws(
        () => normaliseUrl("ftp://example.com"),
        (error: unknown) => error instanceof Error && error.message.includes("http or https"),
    );
});

test("deriveEndpoint returns host:port", () => {
    assert.equal(deriveEndpoint("http://example.com:8080/path"), "example.com:8080");
    assert.equal(deriveEndpoint("http://example.com"), "example.com");
});

test("add then list then byUrl round trip", async () => {
    await withDatabase(() => {
        const row = agentStore.add("http://nas:5001", "admin", "v1$a$b$c", "My NAS");
        assert.equal(row.url, "http://nas:5001");
        assert.equal(row.name, "My NAS");

        const listed = agentStore.list();
        assert.equal(listed.length, 1);
        assert.equal(listed[0]?.url, "http://nas:5001");

        const found = agentStore.byUrl("http://nas:5001");
        assert.equal(found?.username, "admin");
    });
});

test("add rejects a duplicate normalised URL", async () => {
    await withDatabase(() => {
        agentStore.add("http://nas:5001", "admin", "v1$a$b$c", undefined);
        assert.throws(
            () => agentStore.add("http://nas:5001", "admin", "v1$x$y$z", undefined),
            (error: unknown) => error instanceof Error && error.message.includes("already exists"),
        );
    });
});

test("remove deletes the row", async () => {
    await withDatabase(() => {
        agentStore.add("http://nas:5001", "admin", "v1$a$b$c", undefined);
        agentStore.remove("http://nas:5001");
        assert.equal(agentStore.byUrl("http://nas:5001"), undefined);
        assert.deepEqual(agentStore.list(), []);
    });
});

test("rename updates only the display name", async () => {
    await withDatabase(() => {
        const row = agentStore.add("http://nas:5001", "admin", "v1$a$b$c", "Old Name");
        agentStore.rename("http://nas:5001", "New Name");
        const found = agentStore.byUrl("http://nas:5001");
        assert.equal(found?.name, "New Name");
        assert.equal(found?.username, row.username);
        assert.equal(found?.secret, row.secret);
    });
});

test("rename to an empty string clears the name", async () => {
    await withDatabase(() => {
        agentStore.add("http://nas:5001", "admin", "v1$a$b$c", "Has A Name");
        agentStore.rename("http://nas:5001", "");
        const found = agentStore.byUrl("http://nas:5001");
        assert.equal(found?.name, null);
    });
});

test("byUrl returns undefined for an unknown URL", async () => {
    await withDatabase(() => {
        assert.equal(agentStore.byUrl("http://does-not-exist:5001"), undefined);
    });
});
