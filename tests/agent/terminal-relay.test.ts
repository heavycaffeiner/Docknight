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
let endpoint: string;

before(async () => {
    managerRoot = await mkdtemp(join(tmpdir(), "docknight-agent-relay-manager-"));
    managedRoot = await mkdtemp(join(tmpdir(), "docknight-agent-relay-managed-"));
    manager = await spawnServer(join(managerRoot, "data"), join(managerRoot, "stacks"));
    managed = await spawnServer(join(managedRoot, "data"), join(managedRoot, "stacks"), [
        "--enable-console",
        "true",
    ]);
    endpoint = `127.0.0.1:${managed.port}`;

    const managedClient = await setupAndLogin(managed.port);
    managedClient.dispose();

    const managerClient = await setupAndLogin(manager.port);
    const addId = id();
    managerClient.req(addId, "", "agent.add", {
        url: `http://127.0.0.1:${managed.port}`,
        username: "admin",
        password: "CorrectHorse7!",
    });
    const added = await managerClient.response(addId);
    assert.equal(added.ok, true);
    managerClient.dispose();
});

after(async () => {
    await Promise.all([manager.stop(), managed.stop()]);
    await rm(managerRoot, { recursive: true, force: true });
    await rm(managedRoot, { recursive: true, force: true });
});

test("terminalWrite from the remote host's shell reaches only a manager connection joined to it", async () => {
    const joined = await setupAndLogin(manager.port);
    const bystander = await setupAndLogin(manager.port);

    const mainId = id();
    joined.req(mainId, endpoint, "terminal.main", undefined);
    const main = await joined.response(mainId);
    assert.equal(main.ok, true);
    const terminalName = main.ok ? (main.data as { terminal: string }).terminal : "";
    assert.match(terminalName, /^shell-/);

    // terminal.main's join is a side effect on the managed host's own registry, applied to the
    // agent link connection object there; the browser connection on the manager side has to
    // join separately, through the same endpoint, to receive the relay.
    const joinId = id();
    joined.req(joinId, endpoint, "terminal.join", { terminal: terminalName });
    const joinResult = await joined.response(joinId);
    assert.equal(joinResult.ok, true);

    const inputId = id();
    joined.req(inputId, endpoint, "terminal.input", { terminal: terminalName, data: "echo relay-marker-xyz\n" });
    const input = await joined.response(inputId);
    assert.equal(input.ok, true);

    await waitUntil(() => {
        const write = joined
            .events("terminalWrite")
            .find((e) => (e.data as { data: string }).data.includes("relay-marker-xyz"));
        return write;
    }, "the joined connection to see the echoed output");

    // Give the bystander connection, which never joined this terminal, a fair chance to have
    // received the same broadcast if the join filter were broken.
    await delay(300);
    const bystanderSaw = bystander
        .events("terminalWrite")
        .some((e) => (e.data as { data: string }).data.includes("relay-marker-xyz"));
    assert.equal(bystanderSaw, false, "a connection that never joined the terminal must not receive its output");

    // The relayed envelope carries the endpoint of the remote host, not the local "".
    const relayedEvent = joined
        .events("terminalWrite")
        .find((e) => (e.data as { data: string }).data.includes("relay-marker-xyz"));
    assert.equal(relayedEvent?.endpoint, endpoint);

    const leaveId = id();
    joined.req(leaveId, endpoint, "terminal.leave", { terminal: terminalName });
    await joined.response(leaveId);

    joined.dispose();
    bystander.dispose();
});
