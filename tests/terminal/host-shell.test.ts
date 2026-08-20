import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { HEADER_PROTOCOL, PROTOCOL_VERSION, type ServerMessage } from "../../common/protocol.ts";
import type { RunningServer } from "../../backend/server.ts";
import { WS_PATH } from "../../backend/ws/server.ts";
import { startOnFreePort } from "../support/start-on-free-port.ts";

type Response = Extract<ServerMessage, { t: "res" }>;
type Event = Extract<ServerMessage, { t: "evt" }>;

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

interface Client {
    socket: WebSocket;
    frames: ServerMessage[];
    req: (id: number, name: string, params?: unknown) => void;
    response: (id: number) => Promise<Response>;
    dispose: () => void;
}

function connect(port: number): Promise<Client> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`, {
        headers: { [HEADER_PROTOCOL]: String(PROTOCOL_VERSION) },
    });
    const frames: ServerMessage[] = [];
    socket.on("message", (raw: Buffer) => {
        frames.push(JSON.parse(raw.toString("utf8")) as ServerMessage);
    });
    return new Promise((resolve, reject) => {
        socket.once("open", () => {
            const responses = (id: number): Response[] =>
                frames.filter((frame): frame is Response => frame.t === "res" && frame.id === id);
            resolve({
                socket,
                frames,
                req: (id, name, params) => {
                    socket.send(JSON.stringify({ t: "req", id, endpoint: "", method: name, params }));
                },
                response: (id) => waitUntil(() => responses(id)[0], `a response to ${id}`),
                dispose: () => socket.close(1000, "done"),
            });
        });
        socket.once("close", () => reject(new Error("closed during handshake")));
    });
}

let nextId = 1;
function id(): number {
    return nextId++;
}

let running: RunningServer;
let root: string;

before(async () => {
    root = await mkdtemp(join(tmpdir(), "docknight-terminal-console-"));
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
    running = started.running;
});

after(async () => {
    await running.stop("SIGTERM");
    await rm(root, { recursive: true, force: true });
});

async function loginAsAdmin(port: number): Promise<Client> {
    const client = await connect(port);
    const setupId = id();
    client.req(setupId, "auth.setup", { username: "admin", password: "CorrectHorse7!" });
    await client.response(setupId);
    const loginId = id();
    client.req(loginId, "auth.login", { username: "admin", password: "CorrectHorse7!" });
    const login = await client.response(loginId);
    assert.equal(login.ok, true);
    return client;
}

test("a full join/input/resize/leave cycle works once a terminal exists via terminal.main", async () => {
    const client = await loginAsAdmin(running.port);

    const enabledId = id();
    client.req(enabledId, "terminal.mainEnabled");
    const enabled = await client.response(enabledId);
    assert.equal(enabled.ok ? (enabled.data as { enabled: boolean }).enabled : false, true);

    const mainId = id();
    client.req(mainId, "terminal.main");
    const main = await client.response(mainId);
    assert.equal(main.ok, true);
    const terminalName = main.ok ? (main.data as { terminal: string }).terminal : "";
    assert.match(terminalName, /^shell-/);

    const resizeId = id();
    client.req(resizeId, "terminal.resize", { terminal: terminalName, cols: 100, rows: 30 });
    const resize = await client.response(resizeId);
    assert.equal(resize.ok, true);

    const inputId = id();
    client.req(inputId, "terminal.input", { terminal: terminalName, data: "echo hi-there\n" });
    const input = await client.response(inputId);
    assert.equal(input.ok, true);

    await waitUntil(() => {
        const write = client.frames.find(
            (frame): frame is Event =>
                frame.t === "evt" &&
                frame.event === "terminalWrite" &&
                (frame.data as { data: string }).data.includes("hi-there"),
        );
        return write;
    }, "the echoed output");

    const leaveId = id();
    client.req(leaveId, "terminal.leave", { terminal: terminalName });
    const leave = await client.response(leaveId);
    assert.equal(leave.ok, true);

    client.dispose();
});
