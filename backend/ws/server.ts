import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
    HEADER_ENDPOINT,
    HEADER_PROTOCOL,
    MAX_FRAME_BYTES,
    PING_INTERVAL_MS,
    PONG_TIMEOUT_MS,
    PROTOCOL_VERSION,
    type ClientMessage,
    type ServerMessage,
} from "../../common/protocol.ts";
import { log } from "../log.ts";
import * as settings from "../settings.ts";
import type { Conn } from "./conn.ts";
import { allConnections, flushWrites, register, unregister } from "./hub.ts";
import { dispatch } from "./router.ts";

export const WS_PATH = "/ws";

export interface Hooks {
    /** Runs once the connection exists: emits info, setup or autoLogin. */
    onOpen: (conn: Conn) => Promise<void> | void;
    /** Runs on close, before the connection leaves the hub. */
    onClose: (conn: Conn) => void;
}

interface UpgradeContext {
    endpoint: string;
    isAgentLink: boolean;
}

/**
 * Resolve the client address. `X-Forwarded-For` is honoured only when the operator has said the
 * proxy is trusted, because otherwise a client would choose its own rate-limit bucket.
 */
function clientIp(request: IncomingMessage): string {
    if (settings.generalSettings().trustProxy) {
        const header = request.headers["x-forwarded-for"];
        const raw = Array.isArray(header) ? header[0] : header;
        const first = raw?.split(",")[0]?.trim();
        if (first) return first;
    }
    return request.socket.remoteAddress ?? "unknown";
}

/**
 * Upgrade checks. Any failure responds 400 and destroys the socket without completing the
 * handshake.
 */
function checkUpgrade(request: IncomingMessage): UpgradeContext | string {
    const origin = request.headers.origin;
    if (typeof origin === "string" && origin !== "") {
        // A missing Origin is allowed: host-to-host links do not send one. This is what stops a
        // page on another origin from driving Docknight through ambient credentials.
        let originHost: string;
        try {
            originHost = new URL(origin).host;
        } catch {
            return "origin is not a URL";
        }
        if (originHost !== request.headers.host) return "origin does not match host";
    }

    const endpointHeader = request.headers[HEADER_ENDPOINT];
    const endpoint = Array.isArray(endpointHeader) ? endpointHeader[0] : endpointHeader;

    const protocolHeader = request.headers[HEADER_PROTOCOL];
    const protocolRaw = Array.isArray(protocolHeader) ? protocolHeader[0] : protocolHeader;
    if (protocolRaw !== undefined && protocolRaw !== "") {
        const version = Number(protocolRaw);
        if (!Number.isInteger(version) || version !== PROTOCOL_VERSION) {
            return "unsupported protocol version";
        }
    }

    return {
        endpoint: endpoint ?? "",
        isAgentLink: endpoint !== undefined && endpoint !== "",
    };
}

export interface WsServer {
    close(): void;
}

export function attachWebSocketServer(httpServer: HttpServer, hooks: Hooks): WsServer {
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

    const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
        const url = request.url ?? "";
        if (!url.split("?")[0]?.endsWith(WS_PATH)) return;

        const context = checkUpgrade(request);
        if (typeof context === "string") {
            log.warn("ws", `upgrade rejected: ${context}`);
            socket.write(`HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n${context}`);
            socket.destroy();
            return;
        }

        wss.handleUpgrade(request, socket, head, (socketOut) => {
            accept(socketOut, request, context);
        });
    };

    httpServer.on("upgrade", onUpgrade);

    function accept(socket: WebSocket, request: IncomingMessage, context: UpgradeContext): void {
        const conn: Conn = {
            id: randomBytes(6).toString("hex"),
            socket,
            userId: null,
            sessionId: null,
            endpoint: context.endpoint,
            isAgentLink: context.isAgentLink,
            joinedTerminals: new Set(),
            inflight: new Map(),
            openedAt: Date.now(),
            ip: clientIp(request),
            lastPongAt: Date.now(),
            pendingWrites: new Map(),
            flushTimer: null,
            droppedBytes: 0,
            dropping: false,
            closed: false,
            send(message: ServerMessage) {
                if (this.closed || socket.readyState !== socket.OPEN) return;
                socket.send(JSON.stringify(message));
            },
        };

        register(conn);
        log.debug(
            "ws",
            `${conn.id} open from ${conn.ip}${conn.isAgentLink ? ` as link ${conn.endpoint}` : ""}`,
        );

        socket.on("pong", () => {
            conn.lastPongAt = Date.now();
        });

        socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
            if (isBinary) {
                socket.close(1003, "binary frames are not part of this protocol");
                return;
            }
            const text = Array.isArray(raw)
                ? Buffer.concat(raw).toString("utf8")
                : Buffer.from(raw as ArrayBuffer).toString("utf8");

            let msg: ClientMessage;
            try {
                const parsed: unknown = JSON.parse(text);
                if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                    throw new Error("not an object");
                }
                const candidate = parsed as { t?: unknown; id?: unknown; method?: unknown };
                if (candidate.t === "ping") {
                    msg = { t: "ping" };
                } else if (candidate.t === "cancel") {
                    if (!Number.isInteger(candidate.id)) throw new Error("cancel needs an id");
                    msg = { t: "cancel", id: candidate.id as number };
                } else if (candidate.t === "req") {
                    if (!Number.isInteger(candidate.id) || (candidate.id as number) <= 0) {
                        throw new Error("req needs a positive integer id");
                    }
                    if (typeof candidate.method !== "string") throw new Error("req needs a method");
                    const full = parsed as { endpoint?: unknown; params?: unknown };
                    msg = {
                        t: "req",
                        id: candidate.id as number,
                        endpoint: typeof full.endpoint === "string" ? full.endpoint : "",
                        method: candidate.method,
                        params: full.params,
                    };
                } else {
                    throw new Error("unknown message kind");
                }
            } catch (error) {
                log.warn("ws", `${conn.id} sent an unusable frame`, error);
                socket.close(1003, "unparseable message");
                return;
            }

            void dispatch(conn, msg);
        });

        socket.on("close", (code: number) => {
            conn.closed = true;
            if (conn.flushTimer !== null) clearTimeout(conn.flushTimer);
            conn.flushTimer = null;
            for (const controller of conn.inflight.values()) controller.abort();
            conn.inflight.clear();
            hooks.onClose(conn);
            unregister(conn);
            log.debug("ws", `${conn.id} closed with ${code}`);
        });

        socket.on("error", (error: Error) => {
            log.debug("ws", `${conn.id} socket error`, error);
        });

        void Promise.resolve(hooks.onOpen(conn)).catch((error: unknown) => {
            log.error("ws", `${conn.id} open hook failed`, error);
        });
    }

    // Browsers answer pings inside the WebSocket implementation, so no client code is required.
    const keepalive = setInterval(() => {
        const cutoff = Date.now() - PONG_TIMEOUT_MS;
        for (const conn of allConnections()) {
            if (conn.closed) continue;
            if (conn.lastPongAt < cutoff) {
                log.info("ws", `${conn.id} keepalive timeout`);
                flushWrites(conn);
                conn.socket.close(1001, "keepalive timeout");
                continue;
            }
            conn.socket.ping();
        }
    }, PING_INTERVAL_MS);
    keepalive.unref();

    return {
        close(): void {
            clearInterval(keepalive);
            httpServer.off("upgrade", onUpgrade);
            wss.close();
        },
    };
}
