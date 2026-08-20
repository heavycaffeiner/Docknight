import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { startOnFreePort } from "../tests/support/start-on-free-port.ts";
import { WS_PATH } from "./ws/server.ts";

test("stop() closes every WebSocket client with 1001 and is idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-server-"));
    try {
        const { running } = await startOnFreePort(
            ["node", "index.ts", "--data-dir", join(root, "data"), "--stacks-dir", join(root, "stacks")],
            {},
        );

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
