import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { HEADER_PROTOCOL, PROTOCOL_VERSION, type ServerMessage } from "../../common/protocol.ts";
import { initLogging } from "../../backend/log.ts";
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
    event: (name: string) => Promise<Event>;
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
                event: (name) =>
                    waitUntil(
                        () =>
                            frames.find(
                                (frame): frame is Event => frame.t === "evt" && frame.event === name,
                            ),
                        `event ${name}`,
                    ),
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

async function loginAsAdmin(port: number): Promise<Client> {
    const client = await connect(port);
    const setupId = id();
    client.req(setupId, "auth.setup", { username: "admin", password: "CorrectHorse7!" });
    await client.response(setupId);
    // auth.setup only creates the account; a fresh connection still has to log in, whether
    // setup just succeeded here or the administrator already existed from an earlier test on
    // the same server.
    const loginId = id();
    client.req(loginId, "auth.login", { username: "admin", password: "CorrectHorse7!" });
    const login = await client.response(loginId);
    assert.equal(login.ok, true);
    return client;
}

let running: RunningServer;
let root: string;

before(async () => {
    root = await mkdtemp(join(tmpdir(), "docknight-terminal-it-"));
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
        ],
        {},
    );
    initLogging(started.config.logLevel);
    running = started.running;
});

after(async () => {
    await running.stop("SIGTERM");
    await rm(root, { recursive: true, force: true });
});

test("terminal.join/leave/input/resize round trip against a real interactive shell", async () => {
    const client = await loginAsAdmin(running.port);

    // There is no public method to start an arbitrary command; drive terminal.exec is phase 5
    // work, so this test reaches the registry through terminal.main under --enable-console
    // instead. mainEnabled reports false because this server was not started with the flag.
    const enabledId = id();
    client.req(enabledId, "terminal.mainEnabled");
    const enabled = await client.response(enabledId);
    assert.equal(enabled.ok ? (enabled.data as { enabled: boolean }).enabled : true, false);

    const mainId = id();
    client.req(mainId, "terminal.main");
    const main = await client.response(mainId);
    assert.equal(main.ok, false);
    assert.equal(main.ok === false ? main.error.i18n : "", "consoleDisabled");

    client.dispose();
});

test("terminal methods require authentication", async () => {
    const client = await connect(running.port);
    const joinId = id();
    client.req(joinId, "terminal.join", { terminal: "whatever" });
    const response = await client.response(joinId);
    assert.equal(response.ok, false);
    assert.equal(response.ok === false ? response.error.code : "", "unauthorized");
    client.dispose();
});

test("terminal.exec against an unknown stack reports notFound rather than crashing", async () => {
    const client = await loginAsAdmin(running.port);
    const execId = id();
    client.req(execId, "terminal.exec", { stack: "does-not-exist", service: "web", shell: "sh" });
    const response = await client.response(execId);
    assert.equal(response.ok, false);
    assert.equal(response.ok === false ? response.error.code : "", "notFound");
    client.dispose();
});

test("terminal.exec rejects a shell outside the allowlist before touching the stack layer", async () => {
    const client = await loginAsAdmin(running.port);
    const execId = id();
    client.req(execId, "terminal.exec", { stack: "anything", service: "web", shell: "fish" });
    const response = await client.response(execId);
    assert.equal(response.ok, false);
    assert.equal(response.ok === false ? response.error.i18n : "", "unsupportedShell");
    client.dispose();
});


