import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { connect as netConnect } from "node:net";
import { WebSocket } from "ws";
import { ValidationError } from "../../common/errors.ts";
import {
    BACKPRESSURE_DROP_BYTES,
    HEADER_PROTOCOL,
    MAX_FRAME_BYTES,
    PROTOCOL_VERSION,
    type ServerMessage,
} from "../../common/protocol.ts";
import type { Conn } from "../../backend/ws/conn.ts";
import { clearRegistryForTests, method, setForwarder } from "../../backend/ws/router.ts";
import { WS_PATH, createWsLayer } from "../../backend/ws/server.ts";

declare module "../../common/protocol.ts" {
    interface EventMap {
        terminalWrite: { terminal: string; data: string };
    }
}

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
let port = 0;

function portOf(server: Server): number {
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("server is not listening");
    return address.port;
}

before(async () => {
    clearRegistryForTests();

    // Stub methods standing in for the ones real proposals register, so the router's generic
    // behaviour (auth gate, routing, validation, cancellation) is exercised without the rest of
    // the application.
    method("stub.hold", {
        requiresAuth: false,
        routable: false,
        parse: (raw) => raw,
        handle: (_conn, _params, signal) => held(signal),
    });

    method("stub.ok", {
        requiresAuth: false,
        routable: false,
        parse: (raw) => raw,
        handle: () => ({ ok: true }),
    });

    method("stub.setup", {
        requiresAuth: false,
        routable: false,
        parse: (raw: unknown) => {
            if (
                typeof raw !== "object" ||
                raw === null ||
                typeof (raw as { username?: unknown }).username !== "string"
            ) {
                throw new ValidationError("invalidParams", "username: must be a string");
            }
            return raw as { username: string };
        },
        handle: () => ({ ok: true }),
    });

    method("stub.gated", {
        requiresAuth: true,
        routable: false,
        parse: (raw) => raw,
        handle: () => ({ agents: {} }),
    });

    method("stub.routable", {
        requiresAuth: false,
        routable: true,
        parse: (raw) => raw,
        handle: () => ({ ok: true }),
    });

    setForwarder((endpoint) => {
        return new Promise((_resolve, reject) => {
            // Never answers, so the caller's own client-side timeout is what settles it. The
            // real agentTimeout deadline (60 s) belongs to proposal 5's pool; the transport
            // layer here just proves that an unreached forward path never resolves eagerly.
            setTimeout(() => reject(new Error(`no link to ${endpoint}`)), 60_000).unref();
        });
    });

    const ws = createWsLayer({});
    httpServer = createServer();
    httpServer.on("upgrade", ws.upgradeHandler);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    port = portOf(httpServer);
});

after(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
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
    socket.on("error", () => {
        // A protocol violation reaches the test as a close code; the socket error carries nothing more.
    });

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

test("malformed JSON closes the connection with 1003", async () => {
    const client = await connect();
    client.send("not json");
    assert.equal(await waitUntil(client.closeCode, "a close"), 1003);
});

test("a frame with an unknown t closes the connection with 1003", async () => {
    const bad = [
        "[]",
        "null",
        '"a string"',
        '{"t":"nope"}',
        '{"t":"req","id":0,"method":"stub.hold"}',
        '{"t":"req","id":-1,"method":"stub.hold"}',
        '{"t":"req","id":1.5,"method":"stub.hold"}',
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

test("a frame above 1 MiB closes the connection with 1009", async () => {
    const client = await connect();
    const padding = "x".repeat(MAX_FRAME_BYTES);
    client.send(JSON.stringify({ t: "req", id: 1, endpoint: "", method: "stub.hold", params: padding }));
    assert.equal(await waitUntil(client.closeCode, "a close"), 1009);
});

test("a request before auth on a gated method is refused with unauthorized", async () => {
    const client = await connect();
    client.req(1, "stub.gated");
    const response = await client.response(1);
    assert.equal(response.ok === false ? response.error.code : "", "unauthorized");
    client.dispose();
});

test("an unknown method is refused", async () => {
    const client = await connect();
    client.req(1, "nope.nope");
    const response = await client.response(1);
    assert.equal(response.ok === false ? response.error.code : "", "unknownMethod");
    client.dispose();
});

test("a duplicate in-flight request id is refused without disturbing the first", async () => {
    const client = await connect();
    client.req(7, "stub.hold");
    const call = await nextCall();

    client.req(7, "stub.hold");
    const refusal = await client.response(7);
    assert.equal(refusal.ok, false);
    assert.equal(refusal.ok === false ? refusal.error.code : "", "duplicateRequestId");

    call.resolve({ token: "t" });
    await waitUntil(() => (client.responses(7).length === 2 ? true : undefined), "the first answer");
    const answer = client.responses(7)[1];
    assert.equal(answer?.ok, true);
    client.dispose();
});

test("a non-empty endpoint on a non-routable method is refused with notRoutable", async () => {
    const client = await connect();
    client.req(1, "stub.ok", undefined, "nas:5001");
    const response = await client.response(1);
    assert.equal(response.ok === false ? response.error.code : "", "notRoutable");

    client.req(2, "stub.ok");
    assert.equal((await client.response(2)).ok, true);
    client.dispose();
});

test("invalid params come back as invalidParams naming the field", async () => {
    const client = await connect();
    client.req(1, "stub.setup", { username: 42 });
    const response = await client.response(1);
    assert.equal(response.ok === false ? response.error.code : "", "invalidParams");
    assert.equal(response.ok === false ? response.error.message : "", "username: must be a string");
    client.dispose();
});

test("cancel mid-handler aborts it and no response ever arrives for that id", async () => {
    const client = await connect();
    client.req(9, "stub.hold");
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
    client.req(1, "stub.ok");
    assert.equal((await client.response(1)).ok, true);
    client.dispose();
});

test("ping works unauthenticated and is answered with pong", async () => {
    const client = await connect();
    client.send(JSON.stringify({ t: "ping" }));
    await waitUntil(() => client.frames.find((frame) => frame.t === "pong"), "a pong");
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
    client.req(1, "stub.ok");
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

test("a path other than /ws is not upgraded", async () => {
    const rejected = await new Promise<boolean>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/not-ws`);
        socket.on("open", () => {
            socket.close();
            resolve(false);
        });
        socket.on("error", () => resolve(true));
        socket.on("close", () => resolve(true));
    });
    assert.equal(rejected, true);
});

test("server ping timeout closes the connection with 1001", async () => {
    // A real `ws` client answers protocol-level pings automatically, so silence has to come
    // from a raw TCP socket doing the handshake by hand and then never replying to anything.
    // `closeTimeoutMs` is shrunk too: `ws` otherwise waits up to 30 s for a close handshake
    // before giving up on a peer that never acknowledges the close frame.
    const ws = createWsLayer({}, { pingIntervalMs: 30, pongTimeoutMs: 80, closeTimeoutMs: 50 });
    const server = createServer();
    server.on("upgrade", ws.upgradeHandler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const p = portOf(server);

    try {
        const socket = netConnect(p, "127.0.0.1");
        await new Promise<void>((resolve, reject) => {
            socket.once("connect", resolve);
            socket.once("error", reject);
        });
        const key = randomBytes(16).toString("base64");
        socket.write(
            `GET ${WS_PATH} HTTP/1.1\r\n` +
                `Host: 127.0.0.1:${p}\r\n` +
                `Upgrade: websocket\r\n` +
                `Connection: Upgrade\r\n` +
                `Sec-WebSocket-Key: ${key}\r\n` +
                `Sec-WebSocket-Version: 13\r\n` +
                `${HEADER_PROTOCOL}: ${PROTOCOL_VERSION}\r\n\r\n`,
        );
        socket.on("data", () => {
            // Swallow every byte: never reply to a ping, never acknowledge the close frame.
        });

        await waitUntil(() => (ws.conns.size === 1 ? true : undefined), "the raw upgrade to register");

        const deadline = Date.now() + 3000;
        while (ws.conns.size > 0 && Date.now() < deadline) await delay(10);
        assert.equal(ws.conns.size, 0, "the stale connection should have been reaped");

        socket.destroy();
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

test("backpressure: responses still arrive while terminal writes drop, then a truncation notice", async () => {
    clearRegistryForTests();
    method("stub.ok", {
        requiresAuth: false,
        routable: false,
        parse: (raw) => raw,
        handle: () => ({ ok: true }),
    });
    setForwarder(() => Promise.reject(new Error("unused")));

    let markConn: ((conn: Conn) => void) | null = null;
    const connReady = new Promise<Conn>((resolve) => {
        markConn = resolve;
    });
    const ws = createWsLayer({ onConnOpened: (conn) => markConn?.(conn) });
    const server = createServer();
    server.on("upgrade", ws.upgradeHandler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const p = portOf(server);

    try {
        const socket = new WebSocket(`ws://127.0.0.1:${p}${WS_PATH}`, {
            headers: { [HEADER_PROTOCOL]: String(PROTOCOL_VERSION) },
        });
        const frames: ServerMessage[] = [];
        socket.on("message", (raw: Buffer) => {
            frames.push(JSON.parse(raw.toString("utf8")) as ServerMessage);
        });
        await new Promise<void>((resolve) => socket.once("open", resolve));
        const conn = await connReady;
        const rawSocket = (socket as unknown as { _socket: { pause(): void; resume(): void } })._socket;

        // Stop the client from draining, then push well past the 4 MiB drop threshold. A fully
        // paused TCP socket eventually stalls even the transport itself, so this pauses only long
        // enough to build backpressure, matching a slow consumer rather than a dead one.
        rawSocket.pause();
        const chunk = "x".repeat(65536);
        for (let i = 0; i < 200; i += 1) {
            ws.sendEvent(conn, "", "terminalWrite", { terminal: "t", data: chunk });
        }
        await delay(100); // let the 16 ms coalescing timer flush into the OS send buffer
        assert.ok(conn.socket.bufferedAmount > BACKPRESSURE_DROP_BYTES, "backpressure should have built up");

        // More terminal output while still backed up is dropped, not queued forever.
        for (let i = 0; i < 50; i += 1) {
            ws.sendEvent(conn, "", "terminalWrite", { terminal: "t", data: chunk });
        }

        // A plain request/response is never subject to the terminal queue or its drop rule, even
        // while the socket is backed up.
        socket.send(JSON.stringify({ t: "req", id: 1, endpoint: "", method: "stub.ok" }));
        await delay(100);

        rawSocket.resume();

        const responded = await waitUntil(
            () => frames.find((frame): frame is Response => frame.t === "res" && frame.id === 1),
            "a response despite a non-draining client",
        );
        assert.equal(responded.ok, true);

        const truncationNotice = await waitUntil(
            () =>
                frames.find(
                    (frame): frame is Extract<ServerMessage, { t: "evt" }> =>
                        frame.t === "evt" &&
                        frame.event === "terminalWrite" &&
                        typeof (frame.data as { data?: unknown }).data === "string" &&
                        ((frame.data as { data: string }).data.includes("output truncated")),
                ),
            "a truncation notice after the buffer drains",
        );
        assert.match((truncationNotice.data as { data: string }).data, /bytes dropped/);

        socket.close();
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

test("terminal write coalescing: rapid writes arrive in far fewer frames", async () => {
    clearRegistryForTests();
    method("stub.hold", {
        requiresAuth: false,
        routable: false,
        parse: (raw) => raw,
        handle: (_conn, _params, signal) => held(signal),
    });
    method("stub.ok", {
        requiresAuth: false,
        routable: false,
        parse: (raw) => raw,
        handle: () => ({ ok: true }),
    });
    method("stub.setup", {
        requiresAuth: false,
        routable: false,
        parse: (raw) => raw,
        handle: () => ({ ok: true }),
    });
    method("stub.gated", {
        requiresAuth: true,
        routable: false,
        parse: (raw) => raw,
        handle: () => ({ agents: {} }),
    });
    method("stub.routable", {
        requiresAuth: false,
        routable: true,
        parse: (raw) => raw,
        handle: () => ({ ok: true }),
    });
    setForwarder(() => Promise.reject(new Error("unused")));

    const ws = createWsLayer({
        onConnOpened: (conn) => {
            // Emit 1000 rapid terminal writes as soon as the connection opens.
            for (let i = 0; i < 1000; i += 1) {
                ws.sendEvent(conn, "", "terminalWrite", { terminal: "t", data: "x" });
            }
        },
    });
    const server = createServer();
    server.on("upgrade", ws.upgradeHandler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const p = portOf(server);

    try {
        const socket = new WebSocket(`ws://127.0.0.1:${p}${WS_PATH}`, {
            headers: { [HEADER_PROTOCOL]: String(PROTOCOL_VERSION) },
        });
        let frameCount = 0;
        socket.on("message", () => {
            frameCount += 1;
        });
        await new Promise<void>((resolve) => socket.once("open", resolve));
        await delay(300); // well past the 16 ms coalescing window, several times over
        assert.ok(frameCount < 100, `expected far fewer than 1000 frames, got ${frameCount}`);
        socket.close();
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
