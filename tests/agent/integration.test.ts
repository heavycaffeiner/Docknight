import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { HEADER_PROTOCOL, PROTOCOL_VERSION, type ServerMessage } from "../../common/protocol.ts";
import { WS_PATH } from "../../backend/ws/server.ts";
import { spawnServer, type SpawnedServer } from "../support/spawn-server.ts";

type Response = Extract<ServerMessage, { t: "res" }>;
type Event = Extract<ServerMessage, { t: "evt" }>;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil<T>(read: () => T | undefined, what: string, timeoutMs = 15_000): Promise<T> {
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
    req: (id: number, endpoint: string, name: string, params?: unknown) => void;
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
                req: (id, endpoint, name, params) => {
                    socket.send(JSON.stringify({ t: "req", id, endpoint, method: name, params }));
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

async function setupAndLogin(port: number): Promise<Client> {
    const client = await connect(port);
    const setupId = id();
    client.req(setupId, "", "auth.setup", { username: "admin", password: "CorrectHorse7!" });
    await client.response(setupId);
    const loginId = id();
    client.req(loginId, "", "auth.login", { username: "admin", password: "CorrectHorse7!" });
    const login = await client.response(loginId);
    assert.equal(login.ok, true);
    return client;
}

let managerRoot: string;
let managedRoot: string;
let manager: SpawnedServer;
let managed: SpawnedServer;

before(async () => {
    managerRoot = await mkdtemp(join(tmpdir(), "docknight-agent-manager-"));
    managedRoot = await mkdtemp(join(tmpdir(), "docknight-agent-managed-"));
    [manager, managed] = await Promise.all([
        spawnServer(join(managerRoot, "data"), join(managerRoot, "stacks")),
        spawnServer(join(managedRoot, "data"), join(managedRoot, "stacks")),
    ]);
});

after(async () => {
    await Promise.all([manager.stop(), managed.stop()]);
    await rm(managerRoot, { recursive: true, force: true });
    await rm(managedRoot, { recursive: true, force: true });
});

test("add: a credential failure produces a form error and no row; success connects and emits agentList", async () => {
    const managedClient = await setupAndLogin(managed.port);
    managedClient.dispose();

    const managerClient = await setupAndLogin(manager.port);

    const badReqId = id();
    managerClient.req(badReqId, "", "agent.add", {
        url: `http://127.0.0.1:${managed.port}`,
        username: "admin",
        password: "totally-wrong-password",
    });
    const bad = await managerClient.response(badReqId);
    assert.equal(bad.ok, false);

    const listAfterBadId = id();
    managerClient.req(listAfterBadId, "", "agent.list", undefined);
    const listAfterBad = await managerClient.response(listAfterBadId);
    const agentsAfterBad = listAfterBad.ok
        ? (listAfterBad.data as { agents: Record<string, unknown> }).agents
        : {};
    assert.equal(Object.keys(agentsAfterBad).length, 1); // only the synthetic local entry

    const goodId = id();
    managerClient.req(goodId, "", "agent.add", {
        url: `http://127.0.0.1:${managed.port}`,
        username: "admin",
        password: "CorrectHorse7!",
        name: "Managed Host",
    });
    const good = await managerClient.response(goodId);
    assert.equal(good.ok, true);
    const endpoint = good.ok ? (good.data as { endpoint: string }).endpoint : "";
    assert.equal(endpoint, `127.0.0.1:${managed.port}`);

    await waitUntil(() => {
        const events = managerClient.events("agentList");
        const last = events.at(-1);
        const agents = last?.data as { agents: Record<string, unknown> } | undefined;
        return agents !== undefined && endpoint in agents.agents ? true : undefined;
    }, "agentList to include the new host");

    managerClient.dispose();
});

test("add rejects adding self and rejects a duplicate URL", async () => {
    const managerClient = await setupAndLogin(manager.port);

    const selfId = id();
    managerClient.req(selfId, "", "agent.add", {
        url: `http://127.0.0.1:${manager.port}`,
        username: "admin",
        password: "whatever12",
    });
    const selfResponse = await managerClient.response(selfId);
    assert.equal(selfResponse.ok, false);
    assert.equal(selfResponse.ok === false ? selfResponse.error.i18n : "", "cannotAddSelf");

    const dupId = id();
    managerClient.req(dupId, "", "agent.add", {
        url: `http://127.0.0.1:${managed.port}`,
        username: "admin",
        password: "CorrectHorse7!",
    });
    const dupResponse = await managerClient.response(dupId);
    assert.equal(dupResponse.ok, false);
    assert.equal(dupResponse.ok === false ? dupResponse.error.i18n : "", "agentAlreadyExists");

    managerClient.dispose();
});

test("forward: stack.list via the endpoint returns the remote host's stacks", async () => {
    const managerClient = await setupAndLogin(manager.port);
    const endpoint = `127.0.0.1:${managed.port}`;

    await waitUntil(async () => {
        const listId = id();
        managerClient.req(listId, endpoint, "stack.list", undefined);
        const response = await managerClient.response(listId);
        return response.ok ? true : undefined;
    }, "the forwarded stack.list to succeed once the link is online");

    managerClient.dispose();
});

test("relay: an error from the managed host passes through verbatim", async () => {
    const managerClient = await setupAndLogin(manager.port);
    const endpoint = `127.0.0.1:${managed.port}`;

    const execId = id();
    managerClient.req(execId, endpoint, "terminal.exec", {
        stack: "does-not-exist",
        service: "web",
        shell: "sh",
    });
    const response = await managerClient.response(execId);
    assert.equal(response.ok, false);
    assert.equal(response.ok === false ? response.error.code : "", "notFound");

    managerClient.dispose();
});

test("remove: the link closes, the cache drops, and agentList is emitted without the endpoint", async () => {
    const managerClient = await setupAndLogin(manager.port);
    const endpoint = `127.0.0.1:${managed.port}`;

    const removeId = id();
    managerClient.req(removeId, "", "agent.remove", { url: `http://127.0.0.1:${managed.port}` });
    const removed = await managerClient.response(removeId);
    assert.equal(removed.ok, true);

    await waitUntil(() => {
        const events = managerClient.events("agentList");
        const last = events.at(-1);
        const agents = last?.data as { agents: Record<string, unknown> } | undefined;
        return agents !== undefined && !(endpoint in agents.agents) ? true : undefined;
    }, "agentList to drop the removed host");

    const afterRemoveId = id();
    managerClient.req(afterRemoveId, endpoint, "stack.list", undefined);
    const afterRemove = await managerClient.response(afterRemoveId);
    assert.equal(afterRemove.ok, false);
    assert.equal(afterRemove.ok === false ? afterRemove.error.code : "", "agentUnreachable");

    managerClient.dispose();
});

test("no plaintext password is stored in the manager's database file", async () => {
    const { readFile } = await import("node:fs/promises");
    const dbPath = join(managerRoot, "data", "docknight.db");
    const raw = await readFile(dbPath);
    assert.ok(!raw.toString("latin1").includes("CorrectHorse7!"));
});
