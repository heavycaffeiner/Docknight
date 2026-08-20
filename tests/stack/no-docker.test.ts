import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { HEADER_PROTOCOL, PROTOCOL_VERSION, type ServerMessage } from "../../common/protocol.ts";
import { initLogging } from "../../backend/log.ts";
import type { RunningServer } from "../../backend/server.ts";
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
    root = await mkdtemp(join(tmpdir(), "docknight-stack-nodocker-"));
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

test("stack.save then stack.get round trips the compose file and .env", async () => {
    const client = await loginAsAdmin(running.port);
    const saveId = id();
    client.req(saveId, "stack.save", {
        name: "roundtrip",
        composeYAML: "services:\n  web:\n    image: nginx\n",
        composeENV: "FOO=bar\n",
        isCreate: true,
    });
    const save = await client.response(saveId);
    assert.equal(save.ok, true);

    const getId = id();
    client.req(getId, "stack.get", { name: "roundtrip" });
    const get = await client.response(getId);
    assert.equal(get.ok, true);
    const detail = get.ok ? (get.data as { stack: { composeYAML: string; composeENV: string } }).stack : null;
    assert.match(detail?.composeYAML ?? "", /nginx/);
    assert.equal(detail?.composeENV, "FOO=bar\n");

    client.dispose();
});

test("stack.save twice with isCreate true conflicts on the second call", async () => {
    const client = await loginAsAdmin(running.port);
    const first = id();
    client.req(first, "stack.save", {
        name: "conflict-test",
        composeYAML: "services: {}\n",
        composeENV: "",
        isCreate: true,
    });
    assert.equal((await client.response(first)).ok, true);

    const second = id();
    client.req(second, "stack.save", {
        name: "conflict-test",
        composeYAML: "services: {}\n",
        composeENV: "",
        isCreate: true,
    });
    const secondResponse = await client.response(second);
    assert.equal(secondResponse.ok, false);
    assert.equal(secondResponse.ok === false ? secondResponse.error.i18n : "", "stackAlreadyExists");

    client.dispose();
});

test("stack.save rejects a name that escapes the stacks directory", async () => {
    const client = await loginAsAdmin(running.port);
    const saveId = id();
    client.req(saveId, "stack.save", {
        name: "../escape",
        composeYAML: "services: {}\n",
        composeENV: "",
        isCreate: true,
    });
    const response = await client.response(saveId);
    assert.equal(response.ok, false);
    assert.equal(response.ok === false ? response.error.i18n : "", "invalidStackName");
    client.dispose();
});

test("stack.delete refuses a stack directory that is a symlink", async () => {
    const client = await loginAsAdmin(running.port);

    // A directory elsewhere on disk that a symlink inside stacksDir points at, simulating a
    // planted symlink an attacker (or a careless bind mount) could introduce.
    const target = join(root, "outside-target");
    await mkdir(target);
    await writeFile(join(target, "compose.yaml"), "services: {}\n");
    await symlink(target, join(root, "stacks", "planted-symlink"));

    const deleteId = id();
    client.req(deleteId, "stack.delete", { name: "planted-symlink" });
    const response = await client.response(deleteId);
    assert.equal(response.ok, false);
    assert.equal(response.ok === false ? response.error.i18n : "", "invalidStackName");

    client.dispose();
});

test("docker.stats degrades to an empty map when the docker binary is unavailable", async () => {
    const client = await loginAsAdmin(running.port);
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-dir-for-docknight-tests";
    try {
        const statsId = id();
        client.req(statsId, "docker.stats");
        const response = await client.response(statsId);
        assert.equal(response.ok, true);
        assert.deepEqual(response.ok ? response.data : null, { stats: {} });
    } finally {
        process.env.PATH = originalPath;
    }
    client.dispose();
});

test("docker.networks degrades to an empty list when the docker binary is unavailable", async () => {
    const client = await loginAsAdmin(running.port);
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-dir-for-docknight-tests";
    try {
        const networksId = id();
        client.req(networksId, "docker.networks");
        const response = await client.response(networksId);
        assert.equal(response.ok, true);
        assert.deepEqual(response.ok ? response.data : null, { networks: [] });
    } finally {
        process.env.PATH = originalPath;
    }
    client.dispose();
});

test("stack methods require authentication", async () => {
    const client = await connect(running.port);
    const listId = id();
    client.req(listId, "stack.list");
    const response = await client.response(listId);
    assert.equal(response.ok, false);
    assert.equal(response.ok === false ? response.error.code : "", "unauthorized");
    client.dispose();
});
