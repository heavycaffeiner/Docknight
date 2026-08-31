import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { closeDatabase, openDatabase } from "./db/index.ts";
import { runMigrations } from "./db/migrate.ts";
import { Settings } from "./settings.ts";
import {
    getLatestVersion,
    isNewer,
    parsesAsVersion,
    setLatestVersion,
    startVersionCheck,
    VERSION,
} from "./version.ts";

test("isNewer compares numeric dot-separated versions", () => {
    assert.equal(isNewer("1.10.0", "1.6.2"), true);
    assert.equal(isNewer("1.6.2", "1.10.0"), false);
    assert.equal(isNewer("1.6.2", "1.6.2"), false);
    assert.equal(isNewer("2.0.0", "1.99.99"), true);
    assert.equal(isNewer("1.6", "1.6.0"), false);
    assert.equal(isNewer("1.6.1", "1.6"), true);
});

test("isNewer never throws on garbage input and treats it as not newer", () => {
    assert.equal(isNewer("not-a-version", "1.0.0"), false);
    assert.equal(isNewer("1.0.0", "not-a-version"), false);
    assert.equal(isNewer("", "1.0.0"), false);
    assert.equal(isNewer("1.0.0-beta", "1.0.0"), false);
});

async function withDatabase<T>(fn: () => Promise<T> | T): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), "docknight-version-"));
    const dataDir = join(root, "data");
    const stacksDir = join(root, "stacks");
    await mkdir(dataDir, { recursive: true });
    await mkdir(stacksDir, { recursive: true });
    const config = loadConfig(["node", "index.ts", "--data-dir", dataDir, "--stacks-dir", stacksDir], {});
    const db = openDatabase(config);
    runMigrations(db);
    try {
        return await fn();
    } finally {
        closeDatabase();
        await rm(root, { recursive: true, force: true });
    }
}

function fakeConfig(overrides: Partial<{ versionManifestUrl: string }> = {}): Parameters<typeof startVersionCheck>[0] {
    return loadConfig(["node", "index.ts", "--data-dir", "/tmp/x", "--stacks-dir", "/tmp/y"], {
        DOCKNIGHT_VERSION_MANIFEST_URL: overrides.versionManifestUrl ?? "http://example.invalid/version.json",
    });
}

test("checkUpdate=false makes zero fetch calls and never changes latestVersion", async () => {
    await withDatabase(async () => {
        setLatestVersion(undefined);
        Settings.set("checkUpdate", false, "general");
        let fetchCalls = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            fetchCalls += 1;
            throw new Error("must not be called");
        }) as typeof fetch;
        try {
            const stop = startVersionCheck(fakeConfig());
            await new Promise((resolve) => setTimeout(resolve, 20));
            stop();
            assert.equal(fetchCalls, 0);
            assert.equal(getLatestVersion(), undefined);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

test("a successful check sets latestVersion to the stable candidate", async () => {
    await withDatabase(async () => {
        setLatestVersion(undefined);
        Settings.set("checkUpdate", true, "general");
        Settings.set("checkBeta", false, "general");
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response(JSON.stringify({ stable: "99.0.0", beta: "99.1.0-beta" }), {
                status: 200,
            })) as typeof fetch;
        try {
            const stop = startVersionCheck(fakeConfig());
            await new Promise((resolve) => setTimeout(resolve, 20));
            stop();
            assert.equal(getLatestVersion(), "99.0.0");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

test("checkBeta picks the beta candidate when it parses as a version newer than stable", async () => {
    await withDatabase(async () => {
        setLatestVersion(undefined);
        Settings.set("checkUpdate", true, "general");
        Settings.set("checkBeta", true, "general");
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response(JSON.stringify({ stable: "2.0.0", beta: "2.1.0" }), { status: 200 })) as typeof fetch;
        try {
            const stop = startVersionCheck(fakeConfig());
            await new Promise((resolve) => setTimeout(resolve, 20));
            stop();
            assert.equal(getLatestVersion(), "2.1.0");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

test("an unparseable beta candidate falls back to stable rather than storing garbage", async () => {
    await withDatabase(async () => {
        setLatestVersion(undefined);
        Settings.set("checkUpdate", true, "general");
        Settings.set("checkBeta", true, "general");
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response(JSON.stringify({ stable: "2.0.0", beta: "2.1.0-rc" }), { status: 200 })) as typeof fetch;
        try {
            const stop = startVersionCheck(fakeConfig());
            await new Promise((resolve) => setTimeout(resolve, 20));
            stop();
            assert.equal(getLatestVersion(), "2.0.0");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

test("checkBeta off never picks the beta candidate even when it is newer", async () => {
    await withDatabase(async () => {
        setLatestVersion(undefined);
        Settings.set("checkUpdate", true, "general");
        Settings.set("checkBeta", false, "general");
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response(JSON.stringify({ stable: "2.0.0", beta: "2.1.0" }), { status: 200 })) as typeof fetch;
        try {
            const stop = startVersionCheck(fakeConfig());
            await new Promise((resolve) => setTimeout(resolve, 20));
            stop();
            assert.equal(getLatestVersion(), "2.0.0");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

test("a failed fetch leaves latestVersion exactly as it was, never fatal", async () => {
    await withDatabase(async () => {
        setLatestVersion("1.2.3");
        Settings.set("checkUpdate", true, "general");
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            throw new Error("network down");
        }) as typeof fetch;
        try {
            const stop = startVersionCheck(fakeConfig());
            await new Promise((resolve) => setTimeout(resolve, 20));
            stop();
            assert.equal(getLatestVersion(), "1.2.3");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

test("VERSION is read from package.json", () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+/);
});

test("a nightly version is not a release version, so it never auto-upgrades", () => {
    // The guard in check(): only a release build follows the stable channel automatically.
    assert.equal(parsesAsVersion("1.6.3"), true);
    assert.equal(parsesAsVersion("0.0.0-nightly.20260831.f0eba0f"), false);

    // The reason the guard cannot be left to isNewer: a short hash made only of digits
    // parses as an ordinary numeric component, so stable compares as newer and a nightly
    // would be replaced by it. Roughly one commit in twenty-seven hashes this way.
    assert.equal(isNewer("1.6.3", "0.0.0-nightly.20260831.1234567"), true);
    assert.equal(parsesAsVersion("0.0.0-nightly.20260831.1234567"), false);
});
