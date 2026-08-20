import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request } from "node:http";
import { fileURLToPath } from "node:url";

const INDEX_PATH = fileURLToPath(new URL("../../backend/index.ts", import.meta.url));

/** Find a currently free TCP port; config validation rejects the OS-assigns-one convention of 0. */
export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            const port = typeof address === "object" && address !== null ? address.port : 0;
            probe.close((error) => (error ? reject(error) : resolve(port)));
        });
    });
}

export interface SpawnedServer {
    port: number;
    process: ChildProcess;
    stop(): Promise<void>;
}

/**
 * Start a real Docknight process on a free port, in its own OS process. Used by tests that
 * need two independent server instances at once (agent federation), where in-process `start()`
 * would collide on the shared method registry and the lifecycle module's singleton state.
 *
 * `extraArgs` may itself include `--port`, for a caller restarting a process on a specific,
 * already-known port (parseArgs keeps the last occurrence of a flag, so this always wins over
 * the value picked here).
 */
export async function spawnServer(
    dataDir: string,
    stacksDir: string,
    extraArgs: string[] = [],
): Promise<SpawnedServer> {
    const portIndex = extraArgs.indexOf("--port");
    const port = portIndex === -1 ? await freePort() : Number(extraArgs[portIndex + 1]);
    const child = spawn(
        process.execPath,
        [
            INDEX_PATH,
            "--data-dir",
            dataDir,
            "--stacks-dir",
            stacksDir,
            "--port",
            String(port),
            "--log-level",
            "error",
            ...extraArgs,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
    });

    // The default log level is error, so the diagnostic "listening on" line (info level) is
    // not a reliable readiness signal; poll the actual HTTP port instead.
    await new Promise<void>((resolve, reject) => {
        let exited = false;
        const onExit = (code: number | null): void => {
            exited = true;
            reject(new Error(`server process exited early with code ${code}: ${stderr}`));
        };
        child.once("exit", onExit);

        const deadline = Date.now() + 10_000;
        const poll = (): void => {
            if (exited) return;
            if (Date.now() > deadline) {
                reject(new Error(`server did not start in time: ${stderr}`));
                return;
            }
            const probe = request({ host: "127.0.0.1", port, path: "/", method: "GET" }, (res) => {
                res.resume();
                child.off("exit", onExit);
                resolve();
            });
            probe.on("error", () => setTimeout(poll, 50));
            probe.end();
        };
        poll();
    });

    const stop = (): Promise<void> =>
        new Promise((resolve) => {
            if (child.exitCode !== null) {
                resolve();
                return;
            }
            child.once("exit", () => resolve());
            child.kill("SIGTERM");
        });

    return { port, process: child, stop };
}
