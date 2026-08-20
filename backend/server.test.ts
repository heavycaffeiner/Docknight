import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { start } from "./server.ts";

/** Find a currently free TCP port; config validation rejects the OS-assigns-one convention of 0. */
async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            const port = typeof address === "object" && address !== null ? address.port : 0;
            probe.close((error) => (error ? reject(error) : resolve(port)));
        });
    });
}

test("start() listens, serves the placeholder page, and stop() is idempotent and exits clean", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-server-"));
    try {
        const port = await freePort();
        const config = loadConfig(
            [
                "node",
                "index.ts",
                "--data-dir",
                join(root, "data"),
                "--stacks-dir",
                join(root, "stacks"),
                "--port",
                String(port),
            ],
            {},
        );
        const running = await start(config);
        assert.equal(running.port, port);

        const response = await fetch(`http://127.0.0.1:${port}/robots.txt`);
        assert.equal(response.status, 200);

        const firstStop = running.stop("SIGTERM");
        const secondStop = running.stop("SIGTERM");
        assert.equal(firstStop, secondStop, "stop() must return the same promise on a second call");
        await firstStop;
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("a second start against the same data directory applies no migrations and starts clean", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-server-"));
    try {
        const dataDir = join(root, "data");
        const stacksDir = join(root, "stacks");

        const firstPort = await freePort();
        const firstConfig = loadConfig(
            ["node", "index.ts", "--data-dir", dataDir, "--stacks-dir", stacksDir, "--port", String(firstPort)],
            {},
        );
        const first = await start(firstConfig);
        await first.stop("SIGTERM");

        const secondPort = await freePort();
        const secondConfig = loadConfig(
            ["node", "index.ts", "--data-dir", dataDir, "--stacks-dir", stacksDir, "--port", String(secondPort)],
            {},
        );
        const second = await start(secondConfig);
        await second.stop("SIGTERM");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
