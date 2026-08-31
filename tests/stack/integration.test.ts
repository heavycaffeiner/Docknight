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
import { dockerDaemonReachable } from "../support/docker-available.ts";

type Response = Extract<ServerMessage, { t: "res" }>;
type Event = Extract<ServerMessage, { t: "evt" }>;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil<T>(read: () => T | undefined, what: string, timeoutMs = 20_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = read();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await delay(20);
    }
}

interface Client {
    socket: WebSocket;
    frames: ServerMessage[];
    req: (id: number, name: string, params?: unknown) => void;
    response: (id: number) => Promise<Response>;
    events: (name: string) => Event[];
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
                events: (name) =>
                    frames.filter((frame): frame is Event => frame.t === "evt" && frame.event === name),
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

const ALPINE_COMPOSE = "services:\n  web:\n    image: alpine:latest\n    command: sleep 300\n";

before(async () => {
    if (!dockerDaemonReachable) return;
    root = await mkdtemp(join(tmpdir(), "docknight-stack-it-"));
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
    if (!dockerDaemonReachable) return;
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

test(
    "full lifecycle: deploy, stop, start, down, delete of a one-service alpine stack",
    { skip: !dockerDaemonReachable, timeout: 120_000 },
    async () => {
        const client = await loginAsAdmin(running.port);
        const name = "docknight-it-lifecycle";

        const deployId = id();
        client.req(deployId, "stack.deploy", {
            name,
            composeYAML: ALPINE_COMPOSE,
            composeENV: "",
            isCreate: true,
        });
        const deploy = await client.response(deployId);
        assert.equal(deploy.ok, true);
        assert.equal(deploy.ok ? (deploy.data as { exitCode: number }).exitCode : -1, 0);

        // Terminal output actually arrived: the deploy joined the follow log terminal, and
        // the compose command's own terminal streamed something while it ran.
        await waitUntil(
            () => client.events("terminalWrite").find((e) => (e.data as { data: string }).data.length > 0),
            "some terminal output from the deploy",
        );

        await waitUntil(() => {
            const events = client.events("stackList");
            const last = events.at(-1);
            const stacks = last?.data as { stacks: Record<string, { status: number }> } | undefined;
            return stacks?.stacks[name]?.status === 3 ? true : undefined; // RUNNING
        }, "stackList to report the stack running");

        const stopId = id();
        client.req(stopId, "stack.stop", { name });
        const stop = await client.response(stopId);
        assert.equal(stop.ok, true);

        const startId = id();
        client.req(startId, "stack.start", { name });
        const start = await client.response(startId);
        assert.equal(start.ok, true);

        const downId = id();
        client.req(downId, "stack.down", { name });
        const down = await client.response(downId);
        assert.equal(down.ok, true);

        const deleteId = id();
        client.req(deleteId, "stack.delete", { name });
        const del = await client.response(deleteId);
        assert.equal(del.ok, true);

        await waitUntil(() => {
            const events = client.events("stackList");
            const last = events.at(-1);
            const stacks = last?.data as { stacks: Record<string, unknown> } | undefined;
            return stacks !== undefined && !(name in stacks.stacks) ? true : undefined;
        }, "stackList to drop the deleted stack");

        client.dispose();
    },
);

test(
    "two concurrent deploys of the same stack: the second is refused with operationInProgress",
    { skip: !dockerDaemonReachable, timeout: 60_000 },
    async () => {
        const client = await loginAsAdmin(running.port);
        const name = "docknight-it-concurrent";

        const firstId = id();
        client.req(firstId, "stack.deploy", {
            name,
            composeYAML: ALPINE_COMPOSE,
            composeENV: "",
            isCreate: true,
        });

        // Wait for the deploy to have created the stack, rather than guessing at a delay: the
        // race under test is against an operation already in progress, and on a slow runner a
        // fixed pause expires while the stack still does not exist, which answers
        // stackNotFound instead.
        const deadline = Date.now() + 30_000;
        while (client.events("stackList").length === 0 && Date.now() < deadline) {
            await delay(10);
        }
        const secondId = id();
        client.req(secondId, "stack.start", { name });
        const second = await client.response(secondId);
        assert.equal(second.ok, false);
        assert.equal(second.ok === false ? second.error.i18n : "", "operationInProgress");

        const first = await client.response(firstId);
        assert.equal(first.ok, true);

        const downId = id();
        client.req(downId, "stack.down", { name });
        await client.response(downId);
        const deleteId = id();
        client.req(deleteId, "stack.delete", { name });
        await client.response(deleteId);

        client.dispose();
    },
);
