import { RequestError } from "../../common/errors.ts";
import type { AgentStatus, EventName } from "../../common/protocol.ts";
import type { StackSummary } from "../../common/stack.ts";
import { log } from "../log.ts";
import type { Conn } from "../ws/conn.ts";
import { browserConnections, emitTo, queueTerminalWrite } from "../ws/hub.ts";
import { decryptSecret } from "./crypto.ts";
import { Link } from "./link.ts";
import { activeAgents, endpointOf, summaries, type AgentRow } from "./store.ts";

interface StatusEntry {
    status: AgentStatus;
    message?: string;
}

const links = new Map<string, Link>();
const statuses = new Map<string, StatusEntry>();
/** Last known stack list per endpoint, so a browser that connects later is served immediately. */
const stackLists = new Map<string, Record<string, StackSummary>>();

function setStatus(endpoint: string, status: AgentStatus, message?: string): void {
    const entry: StatusEntry = message === undefined ? { status } : { status, message };
    statuses.set(endpoint, entry);
    for (const conn of browserConnections()) {
        emitTo(conn, "agentStatus", endpoint, { endpoint, status, ...(message ? { message } : {}) });
    }
}

/**
 * Relay one event from a managed host. The endpoint is added in the envelope; payloads are never
 * mutated to carry it.
 */
function relayEvent(endpoint: string, event: string, data: unknown): void {
    if (event === "stackList") {
        const payload = data as { stacks?: Record<string, StackSummary> } | null;
        if (payload?.stacks !== undefined) stackLists.set(endpoint, payload.stacks);
    }

    // The manager's own info, setup, autoLogin and refresh are not another host's business.
    if (event === "info" || event === "setup" || event === "autoLogin" || event === "refresh") return;

    for (const conn of browserConnections()) {
        if (event === "terminalWrite") {
            const payload = data as { terminal?: string; data?: string } | null;
            if (typeof payload?.terminal !== "string" || typeof payload.data !== "string") continue;
            if (!conn.joinedTerminals.has(payload.terminal)) continue;
            queueTerminalWrite(conn, endpoint, payload.terminal, payload.data);
            continue;
        }
        if (event === "terminalExit") {
            const payload = data as { terminal?: string; exitCode?: number } | null;
            if (typeof payload?.terminal !== "string") continue;
            if (!conn.joinedTerminals.has(payload.terminal)) continue;
            conn.joinedTerminals.delete(payload.terminal);
        }
        emitTo(conn, event as EventName, endpoint, data as never);
    }
}

function buildLink(row: AgentRow): Link {
    const endpoint = endpointOf(row.url);
    return new Link({
        url: row.url,
        endpoint,
        username: row.username,
        password: () => decryptSecret(row.secret),
        hooks: {
            onStatus: setStatus,
            onEvent: relayEvent,
            onOnline: (link) => {
                // Prime the manager's view without waiting for the host's next tick.
                void link
                    .request("stack.list", undefined)
                    .then((result) => {
                        const payload = result as { stacks?: Record<string, StackSummary> } | null;
                        if (payload?.stacks === undefined) return;
                        stackLists.set(link.endpoint, payload.stacks);
                        for (const conn of browserConnections()) {
                            emitTo(conn, "stackList", link.endpoint, { stacks: payload.stacks });
                        }
                    })
                    .catch((error: unknown) => {
                        log.warn("agent", `${link.endpoint} stack.list failed`, error);
                    });
            },
        },
    });
}

/** Build a link per active host and start connecting, regardless of whether a browser is here. */
export function connectAll(): void {
    for (const row of activeAgents()) connectOne(row);
}

export function connectOne(row: AgentRow): void {
    const endpoint = endpointOf(row.url);
    links.get(endpoint)?.close();
    const link = buildLink(row);
    links.set(endpoint, link);
    link.connect();
}

export function disconnect(endpoint: string): void {
    links.get(endpoint)?.close();
    links.delete(endpoint);
    statuses.delete(endpoint);
    stackLists.delete(endpoint);
}

export function closeAll(): void {
    for (const link of links.values()) link.close(1001);
    links.clear();
}

/**
 * Forward one request to a named host and resolve with its result.
 *
 * @throws RequestError("agentUnreachable") when no link exists or it never came online.
 * @throws the host's own error verbatim when it returned one.
 */
export async function request(
    endpoint: string,
    method: string,
    params: unknown,
    signal: AbortSignal,
): Promise<unknown> {
    const link = links.get(endpoint);
    if (link === undefined) {
        throw new RequestError("agentUnreachable", `no host configured at ${endpoint}`, {
            i18n: "agentUnreachable",
            values: { endpoint },
        });
    }
    if (link.state !== "online") await link.waitOnline();
    return await link.request(method, params, signal);
}

/** Send to every online link and ignore the results. Used for the "*" endpoint. */
export function broadcast(method: string, params: unknown): void {
    for (const link of links.values()) {
        if (link.state !== "online") continue;
        void link.request(method, params).catch((error: unknown) => {
            log.warn("agent", `${link.endpoint} broadcast ${method} failed`, error);
        });
    }
}

export function statusOf(endpoint: string): StatusEntry {
    return statuses.get(endpoint) ?? { status: "offline" };
}

export function knownEndpoints(): string[] {
    return [...links.keys()];
}

export function cachedStackLists(): ReadonlyMap<string, Record<string, StackSummary>> {
    return stackLists;
}

/**
 * Everything a freshly authenticated browser needs to know about the other hosts: the last stack
 * list for each, the host list, and one status per host.
 */
export function primeConnection(conn: Conn): void {
    for (const [endpoint, stacks] of stackLists) {
        emitTo(conn, "stackList", endpoint, { stacks });
    }
    emitTo(conn, "agentList", "", { agents: summaries() });
    for (const endpoint of links.keys()) {
        const entry = statusOf(endpoint);
        emitTo(conn, "agentStatus", endpoint, {
            endpoint,
            status: entry.status,
            ...(entry.message === undefined ? {} : { message: entry.message }),
        });
    }
}

export function emitAgentList(): void {
    const agents = summaries();
    for (const conn of browserConnections()) emitTo(conn, "agentList", "", { agents });
}
