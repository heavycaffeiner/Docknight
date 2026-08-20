import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { HEADER_PROTOCOL, PROTOCOL_VERSION, type ServerMessage } from "../../common/protocol.ts";
import { WS_PATH } from "../../backend/ws/server.ts";
import { startOnFreePort } from "../support/start-on-free-port.ts";

type Response = Extract<ServerMessage, { t: "res" }>;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil<T>(read: () => T | undefined, what: string, timeoutMs = 3_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = read();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await delay(5);
    }
}

let nextId = 1;
function id(): number {
    return nextId++;
}

test(
    "stop() resolves promptly with a live host shell open, proving the terminal shutdown hook is wired",
    { timeout: 10_000 },
    async () => {
        const root = await mkdtemp(join(tmpdir(), "docknight-terminal-shutdown-"));
        try {
            const started = await startOnFreePort(
                [
                    "node",
                    "index.ts",
                    "--data-dir",
                    join(root, "data"),
                    "--stacks-dir",
                    join(root, "stacks"),
                    "--log-level",
                    "error",
                    "--enable-console",
                    "true",
                ],
                {},
            );

            const socket = new WebSocket(`ws://127.0.0.1:${started.running.port}${WS_PATH}`, {
                headers: { [HEADER_PROTOCOL]: String(PROTOCOL_VERSION) },
            });
            const frames: ServerMessage[] = [];
            socket.on("message", (raw: Buffer) => {
                frames.push(JSON.parse(raw.toString("utf8")) as ServerMessage);
            });
            await new Promise<void>((resolve) => socket.once("open", resolve));
            const responses = (reqId: number): Response[] =>
                frames.filter((frame): frame is Response => frame.t === "res" && frame.id === reqId);
            const req = (reqId: number, method: string, params?: unknown): void => {
                socket.send(JSON.stringify({ t: "req", id: reqId, endpoint: "", method, params }));
            };

            const setupId = id();
            req(setupId, "auth.setup", { username: "admin", password: "CorrectHorse7!" });
            await waitUntil(() => responses(setupId)[0], "setup response");

            const loginId = id();
            req(loginId, "auth.login", { username: "admin", password: "CorrectHorse7!" });
            const login = await waitUntil(() => responses(loginId)[0], "login response");
            assert.equal(login.ok, true);

            // A shell that ignores an ordinary Ctrl-C, so a clean shutdown depends on the
            // registry's SIGTERM/SIGKILL escalation actually running, not just the interrupt.
            const mainId = id();
            req(mainId, "terminal.main");
            const main = await waitUntil(() => responses(mainId)[0], "terminal.main response");
            assert.equal(main.ok, true);
            const terminalName = main.ok ? (main.data as { terminal: string }).terminal : "";

            const inputId = id();
            req(inputId, "terminal.input", { terminal: terminalName, data: "trap '' INT TERM\n" });
            await waitUntil(() => responses(inputId)[0], "input response");
            await delay(50); // let the shell actually install the trap before shutdown begins

            const started_at = Date.now();
            await started.running.stop("SIGTERM");
            const elapsedMs = Date.now() - started_at;
            socket.close();

            // The registry's own escalation deadline is 5 s (SIGKILL); the shutdown hard limit
            // is 30 s. A prompt stop within a few seconds is what proves closeAll ran instead
            // of the shutdown hanging on the hard timeout.
            assert.ok(elapsedMs < 8_000, `stop() took ${elapsedMs}ms, expected well under 8000ms`);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    },
);
