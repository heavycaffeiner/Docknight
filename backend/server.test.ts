import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { loadConfig } from "./config.ts";
import { start } from "./server.ts";
import { WS_PATH } from "./ws/server.ts";

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

test("stop() closes every WebSocket client with 1001 and is idempotent", async () => {
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

        const socket = new WebSocket(`ws://127.0.0.1:${running.port}${WS_PATH}`);
        const closeCode = new Promise<number>((resolve) => socket.once("close", resolve));
        await new Promise<void>((resolve) => socket.once("open", resolve));

        const firstStop = running.stop("SIGTERM");
        const secondStop = running.stop("SIGTERM");
        assert.equal(firstStop, secondStop, "stop() must return the same promise on a second call");
        await firstStop;

        assert.equal(await closeCode, 1001);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
