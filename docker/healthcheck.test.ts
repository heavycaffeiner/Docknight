import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(new URL("./healthcheck.ts", import.meta.url));

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            const port = typeof address === "object" && address !== null ? address.port : 0;
            probe.close((error) => (error ? reject(error) : resolve(port)));
        });
    });
}

function runHealthcheck(port: number): Promise<number | null> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SCRIPT_PATH], {
            env: { ...process.env, DOCKNIGHT_PORT: String(port) },
        });
        child.on("error", reject);
        child.on("exit", (code) => resolve(code));
    });
}

test("exits 0 when the configured port is listening", async () => {
    const server = createServer();
    const port = await freePort();
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    try {
        const code = await runHealthcheck(port);
        assert.equal(code, 0);
    } finally {
        server.close();
    }
});

test("exits 1 when nothing is listening on the configured port", async () => {
    const port = await freePort();
    // freePort() closes its own probe before returning, so this port is refused, not just slow.
    const code = await runHealthcheck(port);
    assert.equal(code, 1);
});
