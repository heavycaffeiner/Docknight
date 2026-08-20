import { randomBytes } from "node:crypto";
import { AppError } from "../../common/errors.ts";
import { LOCAL_ENDPOINT, type EventName, type ServerMessage } from "../../common/protocol.ts";
import { log } from "../log.ts";
import type { Conn } from "../ws/conn.ts";
import type { WsLayer } from "../ws/server.ts";
import { encryptSecret } from "./crypto.ts";
import { createLink, type Link, type LinkState } from "./link.ts";
import type { AgentRow } from "./store.ts";

const WAIT_ONLINE_MS = 10_000;
const TEST_CONNECTION_TIMEOUT_MS = 10_000;

/** Methods whose reply can legitimately take longer than the default request deadline. */
const LONG_RUNNING_METHODS = new Set([
    "stack.deploy",
    "stack.start",
    "stack.stop",
    "stack.restart",
    "stack.down",
    "stack.update",
    "stack.delete",
    "service.start",
    "service.stop",
    "service.restart",
]);

export interface AgentStatusPayload {
    endpoint: string;
    status: "connecting" | "online" | "offline";
    message?: string;
}

declare module "../../common/protocol.ts" {
    interface EventMap {
        agentStatus: AgentStatusPayload;
    }
}

export interface AgentPool {
    request(
        endpoint: string,
        method: string,
        params: unknown,
        signal: AbortSignal | null,
        conn: Conn,
    ): Promise<unknown>;
    broadcast(method: string, params: unknown): void;
    connect(agent: AgentRow): void;
    disconnect(endpoint: string): void;
    testConnection(url: string, username: string, password: string): Promise<void>;
    stackCache: Map<string, unknown>;
    statuses: Map<string, AgentStatusPayload>;
    linkState(endpoint: string): LinkState | undefined;
    closeAll(): Promise<void>;
}

function wsUrlOf(url: string): string {
    return url.replace(/^http/, "ws") + "/ws";
}

/** One process-wide connection pool: links, forwarding, event relay, and status. */
export function createAgentPool(ws: WsLayer, key: Buffer): AgentPool {
    const links = new Map<string, Link>();
    const stackCache = new Map<string, unknown>();
    const statuses = new Map<string, AgentStatusPayload>();

    function emitStatus(endpoint: string, status: AgentStatusPayload["status"], message?: string): void {
        const payload: AgentStatusPayload =
            message === undefined ? { endpoint, status } : { endpoint, status, message };
        statuses.set(endpoint, payload);
        ws.broadcastEvent((conn) => conn.userId !== null, LOCAL_ENDPOINT, "agentStatus", payload);
    }

    function relayEvent(endpoint: string, message: Extract<ServerMessage, { t: "evt" }>): void {
        if (message.event === "stackList") stackCache.set(endpoint, message.data);
        for (const conn of ws.conns) {
            if (conn.userId === null || conn.isAgentLink) continue;
            if (message.event === "terminalWrite" || message.event === "terminalExit") {
                const data = message.data as { terminal: string };
                if (!conn.joinedTerminals.has(data.terminal)) continue;
            }
            ws.sendEvent(conn, endpoint, message.event as EventName, message.data as never);
        }
    }

    function connect(agent: AgentRow): void {
        const endpoint = new URL(agent.url).host;
        const link = createLink(agent, {
            key,
            onStatus: (status, message) => emitStatus(endpoint, status, message),
            onEvent: (message) => relayEvent(endpoint, message),
            wsUrl: (a) => wsUrlOf(a.url),
        });
        links.set(endpoint, link);
    }

    function disconnect(endpoint: string): void {
        links.get(endpoint)?.close();
        links.delete(endpoint);
    }

    async function request(
        endpoint: string,
        method: string,
        params: unknown,
        signal: AbortSignal | null,
        conn: Conn,
    ): Promise<unknown> {
        const link = links.get(endpoint);
        if (link === undefined) {
            throw new AppError("agentUnreachable", `no link to ${endpoint}`, "agentUnreachable");
        }
        if (link.state !== "online") {
            const cameOnline = await link.waitOnline(WAIT_ONLINE_MS);
            if (!cameOnline) {
                throw new AppError("agentUnreachable", `no link to ${endpoint}`, "agentUnreachable");
            }
        }
        const timeoutMs = LONG_RUNNING_METHODS.has(method) ? 0 : 60_000;
        const result = await link.request(method, params, signal, timeoutMs);

        // terminal.join and terminal.leave carry an endpoint, so the router forwards them
        // rather than running descriptor.handle locally (proposal 1's routing table); this is
        // therefore the only place the browser connection's own joinedTerminals set can be
        // kept in sync with what it actually subscribed to on the remote host. relayEvent's
        // filter above depends on it to decide who receives a relayed terminalWrite.
        if (method === "terminal.join" || method === "terminal.leave") {
            const terminal = (params as { terminal?: unknown }).terminal;
            if (typeof terminal === "string") {
                if (method === "terminal.join") conn.joinedTerminals.add(terminal);
                else conn.joinedTerminals.delete(terminal);
            }
        }

        return result;
    }

    function broadcast(method: string, params: unknown): void {
        for (const link of links.values()) {
            if (link.state !== "online") continue;
            link.request(method, params, null, 60_000).catch((error: unknown) => {
                log.warn("agent", `broadcast of ${method} failed`, error);
            });
        }
    }

    async function testConnection(url: string, username: string, password: string): Promise<void> {
        // A throwaway key and a row that is never persisted: createLink expects an AgentRow
        // shape, so the password is encrypted just to satisfy that, under a key nothing else
        // ever sees.
        const throwawayKey = randomBytes(32);
        const probeRow: AgentRow = {
            id: -1,
            url,
            username,
            secret: encryptSecret(throwawayKey, password),
            name: null,
            active: 1,
        };

        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (fn: () => void): void => {
                if (settled) return;
                settled = true;
                clearTimeout(deadline);
                link.close();
                fn();
            };
            const deadline = setTimeout(() => {
                finish(() =>
                    reject(
                        new AppError(
                            "agentUnreachable",
                            "connection attempt timed out",
                            "agentUnreachable",
                        ),
                    ),
                );
            }, TEST_CONNECTION_TIMEOUT_MS);

            const link = createLink(probeRow, {
                key: throwawayKey,
                onStatus: (status, message) => {
                    if (status === "online") {
                        finish(resolve);
                    } else if (status === "offline" && message !== undefined) {
                        const code = message === "authentication failed" ? "unauthorized" : "agentUnreachable";
                        const i18n =
                            message === "authentication failed" ? "agentAuthFailed" : "agentUnreachable";
                        finish(() => reject(new AppError(code, message, i18n)));
                    }
                },
                onEvent: () => undefined,
                wsUrl: (a) => wsUrlOf(a.url),
            });
        });
    }

    async function closeAll(): Promise<void> {
        for (const link of links.values()) link.close();
        links.clear();
    }

    return {
        request,
        broadcast,
        connect,
        disconnect,
        testConnection,
        stackCache,
        statuses,
        linkState: (endpoint) => links.get(endpoint)?.state,
        closeAll,
    };
}
