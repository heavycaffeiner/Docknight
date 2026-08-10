import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { ValidationError } from "../../common/errors.ts";
import {
    HEADER_PROTOCOL,
    MAX_FRAME_BYTES,
    PROTOCOL_VERSION,
    type ServerMessage,
} from "../../common/protocol.ts";
import { Link } from "../agent/link.ts";
import { loadConfig } from "../config.ts";
import { closeDatabase, database, openDatabase } from "../db/index.ts";
import { runMigrations } from "../db/migrate.ts";
import { initLogging } from "../log.ts";
import { method } from "./router.ts";
import { WS_PATH, attachWebSocketServer, type WsServer } from "./server.ts";

type Response = Extract<ServerMessage, { t: "res" }>;

interface Call {
    signal: AbortSignal;
    resolve: (value: unknown) => void;
}

const calls: Call[] = [];

/** A handler that runs until the test either releases it or the client cancels the request. */
function held(signal: AbortSignal): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
        calls.push({ signal, resolve });
        signal.addEventListener(
            "abort",
            () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            },
            { once: true },
        );
    });
}

// Real method names, because registration asserts the declared flags against the routing table.
// The method map starts empty here: the application entry point is never imported.
method("auth.login", {
    requiresAuth: false,
    routable: false,
    parse: (raw) => raw,
    handle: (_conn, _params, signal) => held(signal),
});

method("auth.loginByToken", {
    requiresAuth: false,
    routable: false,
    parse: (raw) => raw,
    handle: () => ({ username: "test" }),
});

method("auth.setup", {
    requiresAuth: false,
    routable: false,
    parse: (raw) => {
        if (
            typeof raw !== "object" ||
            raw === null ||
            typeof (raw as { username?: unknown }).username !== "string"
        ) {
            throw new ValidationError("username", "must be a string");
        }
        return raw as { username: string };
    },
    handle: () => ({ ok: true }),
});

method("agent.list", {
    requiresAuth: true,
    routable: false,
    parse: (raw) => raw,
    handle: () => ({ agents: {} }),
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil<T>(read: () => T | undefined, what: string, timeoutMs = 2_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = read();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await delay(5);
    }
}

function nextCall(): Promise<Call> {
    const from = calls.length;
    return waitUntil(
        () => (calls.length > from ? calls[calls.length - 1] : undefined),
        "the handler to start",
    );
}

let httpServer: Server;
let wsServer: WsServer;
let port = 0;
let root = "";

function portOf(server: Server): number {
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("server is not listening");
    return address.port;
}

before(async () => {
    // Every rejected frame is logged as a warning, and a conformance run rejects a lot of them.
    initLogging("error");

    root = await mkdtemp(join(tmpdir(), "docknight-ws-"));
    const dataDir = join(root, "data");
    await mkdir(dataDir);

    // Accepting a connection reads the general settings, to decide whether X-Forwarded-For counts.
    openDatabase(loadConfig(["", "", "--data-dir", dataDir, "--stacks-dir", join(root, "stacks")], {}));
    runMigrations(database());

    httpServer = createServer();
    wsServer = attachWebSocketServer(httpServer, {
        onOpen: () => {
            // No greeting, so every frame a test sees is an answer to what it sent.
        },
        onClose: () => {},
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    port = portOf(httpServer);
});

after(async () => {
    wsServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    closeDatabase();
    await rm(root, { recursive: true, force: true });
});

interface Client {
    socket: WebSocket;
    frames: ServerMessage[];
    closeCode: () => number | undefined;
    send: (raw: string | Buffer) => void;
    req: (id: number, name: string, params?: unknown, endpoint?: string) => void;
    response: (id: number) => Promise<Response>;
    responses: (id: number) => Response[];
    dispose: () => void;
}

async function connect(headers: Record<string, string> = {}): Promise<Client> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`, {
        headers: { [HEADER_PROTOCOL]: String(PROTOCOL_VERSION), ...headers },
        maxPayload: MAX_FRAME_BYTES,
    });

    const frames: ServerMessage[] = [];
    let code: number | undefined;

    socket.on("message", (raw: Buffer) => {
        frames.push(JSON.parse(raw.toString("utf8")) as ServerMessage);
    });
    socket.on("close", (closeCode: number) => {
        code = closeCode;
    });
    // A protocol violation reaches the test as a close code; the socket error carries nothing more.
    socket.on("error", () => {});

    await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("close", () => reject(new Error("closed during the handshake")));
    });

    const responses = (id: number): Response[] =>
        frames.filter((frame): frame is Response => frame.t === "res" && frame.id === id);

    return {
        socket,
        frames,
        closeCode: () => code,
        send: (raw) => socket.send(raw),
        req: (id, name, params, endpoint = "") => {
            socket.send(JSON.stringify({ t: "req", id, endpoint, method: name, params }));
        },
        response: (id) => waitUntil(() => responses(id)[0], `a response to ${id}`),
        responses,
        dispose: () => socket.close(1000, "done"),
    };
}

test("a frame that is not a protocol message closes the connection with 1003", async () => {
    const bad = [
        "not json",
        "[]",
        "null",
        '"a string"',
        '{"t":"nope"}',
        '{"t":"req","id":0,"method":"auth.login"}',
        '{"t":"req","id":-1,"method":"auth.login"}',
        '{"t":"req","id":1.5,"method":"auth.login"}',
        '{"t":"req","id":1}',
        '{"t":"cancel"}',
    ];

    for (const frame of bad) {
        const client = await connect();
        client.send(frame);
        const code = await waitUntil(client.closeCode, `a close after ${frame}`);
        assert.equal(code, 1003, frame);
    }
});

test("a binary frame closes the connection with 1003", async () => {
    const client = await connect();
    client.send(Buffer.from([0x01, 0x02, 0x03]));
    assert.equal(await waitUntil(client.closeCode, "a close"), 1003);
});

test("a frame above the size limit closes the connection with 1009", async () => {
    const client = await connect();
    const padding = "x".repeat(MAX_FRAME_BYTES);
    client.send(JSON.stringify({ t: "req", id: 1, endpoint: "", method: "auth.login", params: padding }));
    assert.equal(await waitUntil(client.closeCode, "a close"), 1009);
});

test("a request id already in flight is refused without disturbing the first", async () => {
    const client = await connect();
    client.req(7, "auth.login");
    const call = await nextCall();

    client.req(7, "auth.login");
    const refusal = await client.response(7);
    assert.equal(refusal.ok, false);
    assert.equal(refusal.ok === false ? refusal.error.code : "", "duplicateRequestId");

    call.resolve({ token: "t" });
    await waitUntil(() => (client.responses(7).length === 2 ? true : undefined), "the first answer");
    const answer = client.responses(7)[1];
    assert.equal(answer?.ok, true);
    client.dispose();
});

test("an unknown method is refused", async () => {
    const client = await connect();
    client.req(1, "nope.nope");
    const response = await client.response(1);
    assert.equal(response.ok === false ? response.error.code : "", "unknownMethod");
    client.dispose();
});

test("a method that requires authentication is refused on an anonymous connection", async () => {
    const client = await connect();
    client.req(1, "agent.list");
    const response = await client.response(1);
    assert.equal(response.ok === false ? response.error.code : "", "unauthorized");
    client.dispose();
});

test("a non-local endpoint on a method that never routes is refused", async () => {
    const client = await connect();
    client.req(1, "auth.loginByToken", { token: "t" }, "nas:5001");
    const response = await client.response(1);
    assert.equal(response.ok === false ? response.error.code : "", "notRoutable");

    client.req(2, "auth.loginByToken", { token: "t" });
    assert.equal((await client.response(2)).ok, true);
    client.dispose();
});

test("parameters that fail validation come back as invalidParams naming the field", async () => {
    const client = await connect();
    client.req(1, "auth.setup", { username: 42 });
    const response = await client.response(1);
    assert.equal(response.ok === false ? response.error.code : "", "invalidParams");
    assert.equal(response.ok === false ? response.error.message : "", "username: must be a string");
    client.dispose();
});

test("a cancel aborts the handler and answers nothing at all", async () => {
    const client = await connect();
    client.req(9, "auth.login");
    const call = await nextCall();

    client.send(JSON.stringify({ t: "cancel", id: 9 }));
    await waitUntil(() => (call.signal.aborted ? true : undefined), "the handler to be aborted");

    // A cancelled request is silent, so waiting is the only way to see the absence of an answer.
    await delay(100);
    assert.deepEqual(client.responses(9), []);
    assert.equal(client.socket.readyState, WebSocket.OPEN);
    client.dispose();
});

test("a cancel for an id that is not in flight is ignored", async () => {
    const client = await connect();
    client.send(JSON.stringify({ t: "cancel", id: 4242 }));
    client.req(1, "auth.loginByToken", { token: "t" });
    assert.equal((await client.response(1)).ok, true);
    client.dispose();
});

test("a ping is answered with a pong on an anonymous connection", async () => {
    const client = await connect();
    client.send(JSON.stringify({ t: "ping" }));
    await waitUntil(
        () => client.frames.find((frame) => frame.t === "pong"),
        "a pong",
    );
    assert.equal(client.socket.readyState, WebSocket.OPEN);
    client.dispose();
});

test("an upgrade from another origin is rejected before the handshake completes", async () => {
    const rejected = await new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`, {
            headers: { origin: "http://evil.test" },
        });
        socket.on("unexpected-response", (_request, response) => {
            socket.terminate();
            resolve(response.statusCode ?? 0);
        });
        socket.on("open", () => {
            socket.close();
            reject(new Error("the upgrade was accepted"));
        });
        socket.on("error", reject);
    });
    assert.equal(rejected, 400);

    const client = await connect({ origin: `http://127.0.0.1:${port}` });
    client.req(1, "auth.loginByToken", { token: "t" });
    assert.equal((await client.response(1)).ok, true);
    client.dispose();
});

test("an upgrade declaring another protocol version is rejected", async () => {
    const rejected = await new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`, {
            headers: { [HEADER_PROTOCOL]: String(PROTOCOL_VERSION + 1) },
        });
        socket.on("unexpected-response", (_request, response) => {
            socket.terminate();
            resolve(response.statusCode ?? 0);
        });
        socket.on("open", () => {
            socket.close();
            reject(new Error("the upgrade was accepted"));
        });
        socket.on("error", reject);
    });
    assert.equal(rejected, 400);
});

test("a forwarded request to a host that never answers fails with agentTimeout", async () => {
    const silent = createServer();
    const accepted = new WebSocketServer({ server: silent });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));

    const link = new Link({
        url: `http://127.0.0.1:${portOf(silent)}`,
        endpoint: "silent",
        username: "manager",
        password: () => "secret",
        hooks: { onStatus: () => {}, onEvent: () => {}, onOnline: () => {} },
    });

    try {
        link.connect();
        await waitUntil(() => (link.state === "authenticating" ? true : undefined), "the link to open");
        await assert.rejects(
            link.request("stack.list", undefined, undefined, 50),
            (error: unknown) => (error as { code?: unknown }).code === "agentTimeout",
        );
    } finally {
        link.close();
        accepted.close();
        await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
});
