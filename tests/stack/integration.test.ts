import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { HEADER_PROTOCOL, PROTOCOL_VERSION, type ServerMessage } from "../../common/protocol.ts";
import { initLogging } from "../../backend/log.ts";
import type { RunningServer } from "../../backend/server.ts";
import { WS_PATH } from "../../backend/ws/server.ts";
import { startOnFreePort } from "../support/start-on-free-port.ts";
import { dockerDaemonReachable } from "../support/docker-available.ts";
import { runCapture } from "../../backend/stack/compose.ts";

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

function responseStackEntries(response: Response): object | null {
    if (!response.ok || typeof response.data !== "object" || response.data === null) return null;
    if (!("stacks" in response.data)) return null;
    const stacks = response.data.stacks;
    return typeof stacks === "object" && stacks !== null ? stacks : null;
}



let running: RunningServer;
let root: string;

const ALPINE_COMPOSE = "services:\n  web:\n    image: alpine:latest\n    command: sleep 300\n";
const ALTERNATE_COMPOSE = "services:\n  web:\n    image: alpine:latest\n    command: sleep 600\n";

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

        // The file appears only after the first deploy holds the lock. A second deploy in
        // update mode would overwrite it if file writes sat outside that boundary.
        const composeFile = join(root, "stacks", name, "compose.yaml");
        const deadline = Date.now() + 30_000;
        while (!existsSync(composeFile) && Date.now() < deadline) {
            await delay(10);
        }
        assert.ok(existsSync(composeFile), "deploy should have written the compose file");
        const secondId = id();
        client.req(secondId, "stack.deploy", {
            name,
            composeYAML: ALTERNATE_COMPOSE,
            composeENV: "SECOND=true\n",
            isCreate: false,
        });
        const second = await client.response(secondId);
        assert.equal(second.ok, false);
        assert.equal(second.ok === false ? second.error.i18n : "", "operationInProgress");

        const first = await client.response(firstId);
        assert.equal(first.ok, true);
        assert.equal(await readFile(composeFile, "utf8"), ALPINE_COMPOSE);

        const downId = id();
        client.req(downId, "stack.down", { name });
        await client.response(downId);
        const deleteId = id();
        client.req(deleteId, "stack.delete", { name });
        await client.response(deleteId);

        client.dispose();
    },
);

test(
    "external project lifecycle uses Docker's reported compose file without deleting it",
    { skip: !dockerDaemonReachable, timeout: 120_000 },
    async () => {
        const name = "docknight-it-external";
        const stacksDir = join(root, "stacks");
        const composeFile = join(stacksDir, `${name}.yaml`);
        await writeFile(composeFile, ALPINE_COMPOSE);
        await runCapture(["compose", "-p", name, "-f", composeFile, "up", "-d"], stacksDir, 60_000);
        const client = await loginAsAdmin(running.port);

        try {
            let visible = false;
            const visibleDeadline = Date.now() + 20_000;
            while (!visible && Date.now() < visibleDeadline) {
                const listId = id();
                client.req(listId, "stack.list");
                const response = await client.response(listId);
                const stacks = responseStackEntries(response);
                const entry =
                    stacks === null ? undefined : Object.getOwnPropertyDescriptor(stacks, name)?.value;
                visible =
                    typeof entry === "object" &&
                    entry !== null &&
                    "managed" in entry &&
                    entry.managed === false;
                if (!visible) await delay(250);
            }
            assert.equal(visible, true, "external project should appear in stack.list");

            const stopId = id();
            client.req(stopId, "stack.stop", { name });
            const stop = await client.response(stopId);
            assert.equal(stop.ok, true);
            const stoppedServices = await runCapture(
                ["compose", "-p", name, "-f", composeFile, "ps", "--status", "running", "--services"],
                stacksDir,
                10_000,
            );
            assert.equal(stoppedServices.trim(), "");

            const startId = id();
            client.req(startId, "stack.start", { name });
            const start = await client.response(startId);
            assert.equal(start.ok, true);
            const runningServices = await runCapture(
                ["compose", "-p", name, "-f", composeFile, "ps", "--status", "running", "--services"],
                stacksDir,
                10_000,
            );
            assert.equal(runningServices.trim(), "web");

            const downId = id();
            client.req(downId, "stack.down", { name });
            const down = await client.response(downId);
            assert.equal(down.ok, true);
            assert.equal(existsSync(composeFile), true);

            let absent = false;
            const absentDeadline = Date.now() + 20_000;
            while (!absent && Date.now() < absentDeadline) {
                const listId = id();
                client.req(listId, "stack.list");
                const response = await client.response(listId);
                const stacks = responseStackEntries(response);
                absent = stacks !== null && !Object.hasOwn(stacks, name);
                if (!absent) await delay(250);
            }
            assert.equal(absent, true, "external project should disappear after compose down");
        } finally {
            await runCapture(
                ["compose", "-p", name, "-f", composeFile, "down", "--remove-orphans"],
                stacksDir,
                30_000,
            ).catch(() => undefined);
            client.dispose();
            await rm(composeFile, { force: true });
        }
    },
);
