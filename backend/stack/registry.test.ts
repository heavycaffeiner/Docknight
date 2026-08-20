import assert from "node:assert/strict";
import { test } from "node:test";
import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventName } from "../../common/protocol.ts";
import type { Conn } from "../ws/conn.ts";
import type { WsLayer } from "../ws/server.ts";
import { loadConfig } from "../config.ts";
import { createStackRegistry } from "./registry.ts";

interface Broadcast {
    endpoint: string;
    event: EventName;
    data: unknown;
}

function fakeWsLayer(): { ws: WsLayer; broadcasts: Broadcast[] } {
    const broadcasts: Broadcast[] = [];
    const ws: WsLayer = {
        upgradeHandler: () => {
            throw new Error("not used in this test");
        },
        conns: new Set<Conn>(),
        sendEvent: () => {
            throw new Error("not used in this test");
        },
        broadcastEvent: (_filter, endpoint, event, data) => {
            broadcasts.push({ endpoint, event, data });
        },
        closeAll: () => Promise.resolve(),
    };
    return { ws, broadcasts };
}

async function withStacksDir(fn: (stacksDir: string) => Promise<void>): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-registry-"));
    try {
        const stacksDir = join(root, "stacks");
        await mkdir(stacksDir);
        await fn(stacksDir);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

function testConfig(stacksDir: string): ReturnType<typeof loadConfig> {
    return loadConfig(
        ["node", "index.ts", "--data-dir", join(stacksDir, "..", "data"), "--stacks-dir", stacksDir],
        {},
    );
}

test("markDirty picks up a newly created stack directory without waiting for the timer", async () => {
    await withStacksDir(async (stacksDir) => {
        const { ws } = fakeWsLayer();
        const registry = createStackRegistry(ws, testConfig(stacksDir));
        assert.deepEqual(registry.snapshot(), {});

        const dir = join(stacksDir, "demo");
        await mkdir(dir);
        await writeFile(join(dir, "compose.yaml"), "services: {}\n");
        registry.markDirty("demo");

        const snapshot = registry.snapshot();
        assert.ok("demo" in snapshot);
        assert.equal(snapshot.demo?.managed, true);
        assert.equal(snapshot.demo?.composeFileName, "compose.yaml");
    });
});

test("a directory without a recognised compose file is not a stack", async () => {
    await withStacksDir(async (stacksDir) => {
        const { ws } = fakeWsLayer();
        const registry = createStackRegistry(ws, testConfig(stacksDir));
        await mkdir(join(stacksDir, "not-a-stack"));
        registry.markDirty("not-a-stack");
        assert.deepEqual(registry.snapshot(), {});
    });
});

test("a directory with a name failing the stack name policy is skipped", async () => {
    await withStacksDir(async (stacksDir) => {
        const { ws } = fakeWsLayer();
        const registry = createStackRegistry(ws, testConfig(stacksDir));
        await mkdir(join(stacksDir, "UPPER-CASE"));
        await writeFile(join(stacksDir, "UPPER-CASE", "compose.yaml"), "services: {}\n");
        registry.markDirty("UPPER-CASE");
        assert.deepEqual(registry.snapshot(), {});
    });
});

test("emitStackList broadcasts the current snapshot to authenticated connections", async () => {
    await withStacksDir(async (stacksDir) => {
        const { ws, broadcasts } = fakeWsLayer();
        const registry = createStackRegistry(ws, testConfig(stacksDir));
        const dir = join(stacksDir, "demo");
        await mkdir(dir);
        await writeFile(join(dir, "compose.yaml"), "services: {}\n");
        registry.markDirty("demo");
        registry.emitStackList();

        assert.equal(broadcasts.length, 1);
        assert.equal(broadcasts[0]?.event, "stackList");
        const data = broadcasts[0]?.data as { stacks: Record<string, unknown> };
        assert.ok("demo" in data.stacks);
    });
});

test("resolve returns the directory for a managed stack and throws for an absent one", async () => {
    await withStacksDir(async (stacksDir) => {
        const { ws } = fakeWsLayer();
        const registry = createStackRegistry(ws, testConfig(stacksDir));
        const dir = join(stacksDir, "demo");
        await mkdir(dir);
        await writeFile(join(dir, "compose.yaml"), "services: {}\n");

        const resolved = registry.resolve("demo");
        assert.equal(resolved.dir, dir);
        assert.equal(resolved.composeFileName, "compose.yaml");

        assert.throws(
            () => registry.resolve("does-not-exist"),
            (error: unknown) => error instanceof Error && error.message.includes("no stack named"),
        );
    });
});

test("resolve is usable immediately after a create, before any scan runs", async () => {
    await withStacksDir(async (stacksDir) => {
        const { ws } = fakeWsLayer();
        const registry = createStackRegistry(ws, testConfig(stacksDir));
        const dir = join(stacksDir, "brand-new");
        await mkdir(dir);
        await writeFile(join(dir, "compose.yaml"), "services: {}\n");
        // No markDirty call here: resolve reads the filesystem directly, not the cache.
        const resolved = registry.resolve("brand-new");
        assert.equal(resolved.dir, dir);
    });
});

function dockerSocketReachable(): boolean {
    try {
        accessSync("/var/run/docker.sock", constants.R_OK | constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

test(
    "startRefreshTimer scans immediately, runs refreshStatus, and emits at least once",
    { skip: !dockerSocketReachable() },
    async () => {
        await withStacksDir(async (stacksDir) => {
            const { ws, broadcasts } = fakeWsLayer();
            const registry = createStackRegistry(ws, testConfig(stacksDir), { refreshIntervalMs: 20 });
            const stop = registry.startRefreshTimer();
            await new Promise((resolve) => setTimeout(resolve, 100));
            stop();
            assert.ok(broadcasts.length >= 1);
            assert.ok(broadcasts.every((b) => b.event === "stackList"));
        });
    },
);

test(
    "a failed refreshStatus tick never crashes the timer; the next tick still fires",
    { skip: !dockerSocketReachable() },
    async () => {
        await withStacksDir(async (stacksDir) => {
            const { ws, broadcasts } = fakeWsLayer();
            const originalPath = process.env.PATH;
            process.env.PATH = "/nonexistent-dir-for-docknight-tests";
            try {
                const registry = createStackRegistry(ws, testConfig(stacksDir), {
                    refreshIntervalMs: 20,
                });
                const stop = registry.startRefreshTimer();
                await new Promise((resolve) => setTimeout(resolve, 100));
                stop();
                // Every tick still emits stackList even though refreshStatus failed every time.
                assert.ok(broadcasts.length >= 2);
            } finally {
                process.env.PATH = originalPath;
            }
        });
    },
);
