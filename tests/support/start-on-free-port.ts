import { createServer } from "node:http";
import type { Config } from "../../backend/config.ts";
import { loadConfig } from "../../backend/config.ts";
import { start, type RunningServer } from "../../backend/server.ts";

/** Find a currently free TCP port; config validation rejects the OS-assigns-one convention of 0. */
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

/**
 * Start a real server on a free port, for integration tests only. Retries on EADDRINUSE: a
 * port found free by `freePort()` can be claimed by another process, most often another test
 * file running concurrently, in the gap before this process binds it.
 */
export async function startOnFreePort(
    args: string[],
    env: NodeJS.ProcessEnv,
    attempts = 5,
): Promise<{ config: Readonly<Config>; running: RunningServer }> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const port = await freePort();
        const config = loadConfig([...args, "--port", String(port)], env);
        try {
            const running = await start(config);
            return { config, running };
        } catch (error) {
            const isPortTaken = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
            if (!isPortTaken || attempt === attempts) throw error;
        }
    }
    throw new Error("unreachable");
}
