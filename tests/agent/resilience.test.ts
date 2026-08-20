import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { HEADER_PROTOCOL, PROTOCOL_VERSION, type ServerMessage } from "../../common/protocol.ts";
import { WS_PATH } from "../../backend/ws/server.ts";
import { freePort, spawnServer, type SpawnedServer } from "../support/spawn-server.ts";

type Response = Extract<ServerMessage, { t: "res" }>;
type Event = Extract<ServerMessage, { t: "evt" }>;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil<T>(read: () => T | undefined, what: string, timeoutMs = 15_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = read();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await delay(30);
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

function statusesOf(client: Client, endpoint: string): string[] {
    return client
        .events("agentStatus")
        .filter((e) => (e.data as { endpoint: string }).endpoint === endpoint)
        .map((e) => (e.data as { status: string }).status);
}

test(
    "link resilience: killing the managed process reports offline, and restarting it recovers",
    { timeout: 30_000 },
    async () => {
        const managerRoot = await mkdtemp(join(tmpdir(), "docknight-agent-resilience-manager-"));
        const managedRoot = await mkdtemp(join(tmpdir(), "docknight-agent-resilience-managed-"));
        let manager: SpawnedServer | null = null;
        let managed: SpawnedServer | null = null;
        try {
            manager = await spawnServer(join(managerRoot, "data"), join(managerRoot, "stacks"));
            const managedPort = await freePort();
            managed = await spawnServer(join(managedRoot, "data"), join(managedRoot, "stacks"), [
                "--port",
                String(managedPort),
            ]);

            const managedClient = await setupAndLogin(managed.port);
            managedClient.dispose();

            const managerClient = await setupAndLogin(manager.port);
            const endpoint = `127.0.0.1:${managed.port}`;

            const addId = id();
            managerClient.req(addId, "", "agent.add", {
                url: `http://127.0.0.1:${managed.port}`,
                username: "admin",
                password: "CorrectHorse7!",
            });
            const added = await managerClient.response(addId);
            assert.equal(added.ok, true);

            await waitUntil(
                () => (statusesOf(managerClient, endpoint).includes("online") ? true : undefined),
                "the link to report online",
            );

            await managed.stop();

            await waitUntil(() => {
                const latest = statusesOf(managerClient, endpoint).at(-1);
                return latest === "offline" ? true : undefined;
            }, "the link to report offline after the managed process dies");

            // Restart a fresh process bound to the exact same port the agent record points at.
            // The link's first backoff step is ~1 s, so this proves the Backoff -> Connecting ->
            // Online path within a couple of retries, not merely eventual reconnection.
            managed = await spawnServer(join(managedRoot, "data"), join(managedRoot, "stacks"), [
                "--port",
                String(managedPort),
            ]);

            await waitUntil(() => {
                const statuses = statusesOf(managerClient, endpoint);
                return statuses.at(-1) === "online" ? true : undefined;
            }, "the link to recover once the managed process is back");

            managerClient.dispose();
        } finally {
            await manager?.stop();
            await managed?.stop();
            await rm(managerRoot, { recursive: true, force: true });
            await rm(managedRoot, { recursive: true, force: true });
        }
    },
);

test(
    "wrong credentials at agent.add fail the pre-flight check without storing a row",
    { timeout: 30_000 },
    async () => {
        const managerRoot = await mkdtemp(join(tmpdir(), "docknight-agent-wrongpass-manager-"));
        const managedRoot = await mkdtemp(join(tmpdir(), "docknight-agent-wrongpass-managed-"));
        let manager: SpawnedServer | null = null;
        let managed: SpawnedServer | null = null;
        try {
            manager = await spawnServer(join(managerRoot, "data"), join(managerRoot, "stacks"));
            managed = await spawnServer(join(managedRoot, "data"), join(managedRoot, "stacks"));

            const managedClient = await setupAndLogin(managed.port);
            managedClient.dispose();

            const managerClient = await setupAndLogin(manager.port);

            const addId = id();
            managerClient.req(addId, "", "agent.add", {
                url: `http://127.0.0.1:${managed.port}`,
                username: "admin",
                password: "the-wrong-password-entirely",
            });
            const added = await managerClient.response(addId);
            assert.equal(added.ok, false);
            assert.equal(added.ok === false ? added.error.code : "", "unauthorized");
            assert.equal(added.ok === false ? added.error.i18n : "", "agentAuthFailed");

            const listId = id();
            managerClient.req(listId, "", "agent.list", undefined);
            const list = await managerClient.response(listId);
            const agents = list.ok ? (list.data as { agents: Record<string, unknown> }).agents : {};
            assert.equal(Object.keys(agents).length, 1); // only the synthetic local entry

            managerClient.dispose();
        } finally {
            await manager?.stop();
            await managed?.stop();
            await rm(managerRoot, { recursive: true, force: true });
            await rm(managedRoot, { recursive: true, force: true });
        }
    },
);
