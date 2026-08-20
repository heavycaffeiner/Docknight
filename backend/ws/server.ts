import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type ServerOptions, type WebSocket } from "ws";
import {
    HEADER_ENDPOINT,
    HEADER_PROTOCOL,
    MAX_FRAME_BYTES,
    PING_INTERVAL_MS,
    PONG_TIMEOUT_MS,
    PROTOCOL_VERSION,
    type EventMap,
    type EventName,
    type ServerMessage,
} from "../../common/protocol.ts";
import { log } from "../log.ts";
import { sendRaw, type Conn, type TermQueue } from "./conn.ts";
import { onMessage } from "./router.ts";

export const WS_PATH = "/ws";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomBase62(length: number): string {
    const bytes = randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i += 1) {
        out += BASE62[(bytes[i] as number) % BASE62.length];
    }
    return out;
}

/** Hooks other layers register on the connection lifecycle. Filled in by later phases. */
export interface WsHooks {
    onConnOpened?: (conn: Conn) => void;
    onConnClosed?: (conn: Conn) => void;
}

export interface WsLayer {
    upgradeHandler: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
    conns: Set<Conn>;
    sendEvent<E extends EventName>(conn: Conn, endpoint: string, event: E, data: EventMap[E]): void;
    broadcastEvent<E extends EventName>(
        filter: (conn: Conn) => boolean,
        endpoint: string,
        event: E,
        data: EventMap[E],
    ): void;
    /** Close every connection, used by the ordered shutdown. Registered as a shutdown hook. */
    closeAll(code: number): Promise<void>;
}

function respond400(socket: Duplex, reason: string): void {
    log.debug("ws", `upgrade rejected: ${reason}`);
    socket.write(`HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n${reason}`);
    socket.destroy();
}

function headerValue(raw: string | string[] | undefined): string | undefined {
    return Array.isArray(raw) ? raw[0] : raw;
}

const TERMINAL_WRITE_COALESCE_MS = 16;
const TERMINAL_DROP_RECHECK_MS = 100;
const TERMINAL_BACKPRESSURE_DROP_BYTES = 4 * 1024 * 1024;
const TERMINAL_BACKPRESSURE_RESUME_BYTES = 1024 * 1024;
const TERMINAL_BACKPRESSURE_CLOSE_BYTES = 16 * 1024 * 1024;

/** Flush one terminal's coalesced buffer as a single terminalWrite event. */
function flushTermQueue(conn: Conn, key: string, queue: TermQueue): void {
    queue.timer = null;
    if (conn.socket.readyState !== conn.socket.OPEN) {
        conn.termQueues.delete(key);
        return;
    }

    const buffered = conn.socket.bufferedAmount;
    if (buffered > TERMINAL_BACKPRESSURE_CLOSE_BYTES) {
        log.warn("ws", `${conn.id} send buffer above the hard limit, closing`);
        conn.socket.close(1013, "not draining");
        conn.termQueues.delete(key);
        return;
    }

    if (buffered > TERMINAL_BACKPRESSURE_DROP_BYTES) {
        queue.dropped += Buffer.byteLength(queue.pending, "utf8");
        queue.pending = "";
        queue.timer = setTimeout(() => flushTermQueue(conn, key, queue), TERMINAL_DROP_RECHECK_MS);
        return;
    }

    if (queue.dropped > 0 && buffered < TERMINAL_BACKPRESSURE_RESUME_BYTES) {
        queue.pending = `\r\n[docknight] output truncated, ${queue.dropped} bytes dropped\r\n${queue.pending}`;
        queue.dropped = 0;
    }

    if (queue.pending.length === 0) return;
    sendRaw(conn, {
        t: "evt",
        endpoint: queue.endpoint,
        event: "terminalWrite",
        data: { terminal: queue.terminal, data: queue.pending },
    });
    queue.pending = "";
}

function enqueueTerminalWrite(
    conn: Conn,
    endpoint: string,
    data: { terminal: string; data: string },
): void {
    const key = `${endpoint}\u0000${data.terminal}`;
    let queue = conn.termQueues.get(key);
    if (queue === undefined) {
        queue = { endpoint, terminal: data.terminal, pending: "", dropped: 0, timer: null };
        conn.termQueues.set(key, queue);
    }
    queue.pending += data.data;
    if (queue.timer === null) {
        queue.timer = setTimeout(
            () => flushTermQueue(conn, key, queue as TermQueue),
            TERMINAL_WRITE_COALESCE_MS,
        );
    }
}

/**
 * Resolve the client address. `X-Forwarded-For` is captured here but interpreted only when the
 * caller later confirms the proxy is trusted, because otherwise a client could pick its own
 * rate-limit bucket.
 */
function remoteAddressOf(request: IncomingMessage): string {
    return request.socket.remoteAddress ?? "unknown";
}

/**
 * Upgrade checks, in order. Any failure responds 400 and destroys the socket before the
 * handshake completes.
 */
function checkUpgrade(
    request: IncomingMessage,
): { endpoint: string; isAgentLink: boolean } | string {
    const origin = request.headers.origin;
    if (typeof origin === "string" && origin !== "") {
        let originHost: string;
        try {
            originHost = new URL(origin).host;
        } catch {
            return "origin is not a URL";
        }
        if (originHost !== request.headers.host) return "origin does not match host";
    }

    const endpointHeader = headerValue(request.headers[HEADER_ENDPOINT]);
    const protocolRaw = headerValue(request.headers[HEADER_PROTOCOL]);
    if (protocolRaw !== undefined && protocolRaw !== "") {
        const version = Number.parseInt(protocolRaw, 10);
        if (!Number.isInteger(version) || version !== PROTOCOL_VERSION) {
            return "unsupported protocol version";
        }
    }

    return {
        endpoint: endpointHeader ?? "",
        isAgentLink: endpointHeader !== undefined && endpointHeader !== "",
    };
}

export interface WsLayerOptions {
    /** Overrides for tests; production uses the module constants. */
    pingIntervalMs?: number;
    pongTimeoutMs?: number;
    /** How long `ws` waits for a close handshake before destroying the raw socket. Test-only. */
    closeTimeoutMs?: number;
}

/** Build the WebSocket layer: upgrade handling, connection registry, event send, keepalive. */
export function createWsLayer(hooks: WsHooks, options: WsLayerOptions = {}): WsLayer {
    // `closeTimeout` is a real `ws` option (how long it waits for a close handshake before
    // destroying the raw socket) that @types/ws does not declare; test-only, cast at the edge.
    const serverOptions: ServerOptions & { closeTimeout?: number } = {
        noServer: true,
        maxPayload: MAX_FRAME_BYTES,
        ...(options.closeTimeoutMs === undefined ? {} : { closeTimeout: options.closeTimeoutMs }),
    };
    const wss = new WebSocketServer(serverOptions);
    const conns = new Set<Conn>();
    const pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
    const pongTimeoutMs = options.pongTimeoutMs ?? PONG_TIMEOUT_MS;

    function accept(socket: WebSocket, request: IncomingMessage, context: { endpoint: string; isAgentLink: boolean }): void {
        const conn: Conn = {
            id: randomBase62(12),
            socket,
            userId: null,
            sessionId: null,
            endpoint: context.endpoint,
            isAgentLink: context.isAgentLink,
            joinedTerminals: new Set(),
            inflight: new Map(),
            openedAt: Date.now(),
            lastPongAt: Date.now(),
            remoteAddress: remoteAddressOf(request),
            forwardedFor: headerValue(request.headers["x-forwarded-for"]),
            termQueues: new Map(),
        };
        conns.add(conn);
        log.debug(
            "ws",
            `${conn.id} open from ${conn.remoteAddress}${conn.isAgentLink ? ` as link ${conn.endpoint}` : ""}`,
        );

        socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
            if (isBinary) {
                socket.close(1003, "binary frames are not part of this protocol");
                return;
            }
            const text = Array.isArray(raw)
                ? Buffer.concat(raw).toString("utf8")
                : Buffer.from(raw as ArrayBuffer).toString("utf8");
            onMessage(conn, text);
        });

        socket.on("pong", () => {
            conn.lastPongAt = Date.now();
        });

        socket.on("close", (code: number) => {
            conns.delete(conn);
            for (const controller of conn.inflight.values()) controller.abort();
            conn.inflight.clear();
            for (const queue of conn.termQueues.values()) {
                if (queue.timer !== null) clearTimeout(queue.timer);
            }
            conn.termQueues.clear();
            hooks.onConnClosed?.(conn);
            log.debug("ws", `${conn.id} closed with ${code}`);
        });

        socket.on("error", (error: Error) => {
            log.debug("ws", `${conn.id} socket error`, error);
        });

        hooks.onConnOpened?.(conn);
    }

    const upgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
        const path = (request.url ?? "").split("?")[0];
        if (path !== WS_PATH) {
            socket.destroy();
            return;
        }

        const context = checkUpgrade(request);
        if (typeof context === "string") {
            respond400(socket, context);
            return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => accept(ws, request, context));
    };

    // Browsers answer WebSocket-level pings inside the implementation, so no client code runs
    // this; host-to-host links apply the same rule in both directions.
    const keepalive = setInterval(() => {
        const cutoff = Date.now() - pongTimeoutMs;
        for (const conn of conns) {
            if (conn.lastPongAt < cutoff) {
                log.info("ws", `${conn.id} keepalive timeout`);
                conn.socket.close(1001, "keepalive timeout");
                continue;
            }
            conn.socket.ping();
        }
    }, pingIntervalMs);
    keepalive.unref();

    function sendEvent<E extends EventName>(
        conn: Conn,
        endpoint: string,
        event: E,
        data: EventMap[E],
    ): void {
        if (event === "terminalWrite") {
            enqueueTerminalWrite(conn, endpoint, data as unknown as { terminal: string; data: string });
            return;
        }
        sendRaw(conn, { t: "evt", endpoint, event: event as string, data } as ServerMessage);
    }

    function broadcastEvent<E extends EventName>(
        filter: (conn: Conn) => boolean,
        endpoint: string,
        event: E,
        data: EventMap[E],
    ): void {
        for (const conn of conns) {
            if (filter(conn)) sendEvent(conn, endpoint, event, data);
        }
    }

    async function closeAll(code: number): Promise<void> {
        clearInterval(keepalive);
        const targets = [...conns];
        for (const conn of targets) {
            try {
                conn.socket.close(code, "server shutting down");
            } catch {
                // Already gone.
            }
        }
        const deadline = Date.now() + 3000;
        while (conns.size > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }

    return { upgradeHandler, conns, sendEvent, broadcastEvent, closeAll };
}
