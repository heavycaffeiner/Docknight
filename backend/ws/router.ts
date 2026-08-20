import { AppError, ValidationError, isAbortError } from "../../common/errors.ts";
import { BROADCAST_ENDPOINT, LOCAL_ENDPOINT, type ProtocolError } from "../../common/protocol.ts";
import { log } from "../log.ts";
import { sendRaw, type Conn } from "./conn.ts";

export interface MethodDescriptor<P, R> {
    requiresAuth: boolean;
    routable: boolean;
    /** Validates and narrows the untrusted params object, throwing ValidationError on mismatch. */
    parse: (raw: unknown) => P;
    handle: (conn: Conn, params: P, signal: AbortSignal) => Promise<R> | R;
}

/**
 * Forwards a request to a remote host by endpoint label. A stub that always rejects with
 * `agentUnreachable` until proposal 5's agent pool replaces it via `setForwarder`. `conn` is
 * passed through so the pool can track which local browser connection is joined to which
 * remote terminal name, for relay filtering; the pool never needs to route through it.
 */
export type Forwarder = (
    endpoint: string,
    method: string,
    params: unknown,
    signal: AbortSignal,
    conn: Conn,
) => Promise<unknown>;

/** Fans a method out to every connected host. A stub that logs until `setBroadcaster` replaces it. */
export type Broadcaster = (method: string, params: unknown) => void;

const registry = new Map<string, MethodDescriptor<unknown, unknown>>();

let forward: Forwarder = (endpoint) => {
    return Promise.reject(
        new AppError("agentUnreachable", `no link to ${endpoint}`, "agentUnreachable"),
    );
};

let broadcast: Broadcaster = (method) => {
    log.debug("ws", `broadcast of ${method} has no agent pool yet`);
};

export function setForwarder(fn: Forwarder): void {
    forward = fn;
}

export function setBroadcaster(fn: Broadcaster): void {
    broadcast = fn;
}

/** Register one method. Throws at startup on a duplicate name. */
export function method<P, R>(name: string, descriptor: MethodDescriptor<P, R>): void {
    if (registry.has(name)) throw new Error(`${name} is registered twice`);
    registry.set(name, descriptor as MethodDescriptor<unknown, unknown>);
}

export function registeredMethods(): readonly string[] {
    return [...registry.keys()];
}

/** Only for tests: drop every registered method so a test file starts from a clean registry. */
export function clearRegistryForTests(): void {
    registry.clear();
}

/** Map any thrown value onto a wire error. Anything not an AppError is logged and reduced. */
export function toProtocolError(error: unknown): ProtocolError {
    if (error instanceof AppError) return error.toProtocolError();
    log.error("ws", "handler failed", error);
    // invariant: no path, env value, or stack trace crosses the wire
    return { code: "internal", message: "internal error" };
}

function respondErr(conn: Conn, id: number, error: ProtocolError): void {
    sendRaw(conn, { t: "res", id, ok: false, error });
}

interface ParsedReq {
    t: "req";
    id: number;
    endpoint: string;
    method: string;
    params?: unknown;
}
interface ParsedCancel {
    t: "cancel";
    id: number;
}
interface ParsedPing {
    t: "ping";
}
type ParsedMessage = ParsedReq | ParsedCancel | ParsedPing;

/** Narrow raw JSON into one of the three client message shapes, or null when it is unusable. */
function parseMessage(raw: unknown): ParsedMessage | null {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const candidate = raw as { t?: unknown; id?: unknown; endpoint?: unknown; method?: unknown };

    if (candidate.t === "ping") return { t: "ping" };

    if (candidate.t === "cancel") {
        if (!Number.isInteger(candidate.id)) return null;
        return { t: "cancel", id: candidate.id as number };
    }

    if (candidate.t === "req") {
        if (typeof candidate.id !== "number" || candidate.id <= 0 || !Number.isInteger(candidate.id)) {
            return null;
        }
        if (typeof candidate.method !== "string") return null;
        if (candidate.endpoint !== undefined && typeof candidate.endpoint !== "string") return null;
        return {
            t: "req",
            id: candidate.id,
            endpoint: typeof candidate.endpoint === "string" ? candidate.endpoint : "",
            method: candidate.method,
            params: (raw as { params?: unknown }).params,
        };
    }

    return null;
}

/** Handle one inbound frame. Closes the connection with 1003 on anything structurally invalid. */
export function onMessage(conn: Conn, raw: string): void {
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        conn.socket.close(1003, "malformed JSON");
        return;
    }

    const msg = parseMessage(json);
    if (msg === null) {
        conn.socket.close(1003, "unparseable message");
        return;
    }

    if (msg.t === "ping") {
        sendRaw(conn, { t: "pong" });
        return;
    }

    if (msg.t === "cancel") {
        conn.inflight.get(msg.id)?.abort();
        return;
    }

    // msg.t === "req"
    if (conn.inflight.has(msg.id)) {
        respondErr(conn, msg.id, {
            code: "duplicateRequestId",
            message: `request id ${msg.id} is already in flight`,
        });
        return;
    }

    const descriptor = registry.get(msg.method);
    if (descriptor === undefined) {
        respondErr(conn, msg.id, { code: "unknownMethod", message: `no method ${msg.method}` });
        return;
    }

    if (descriptor.requiresAuth && conn.userId === null) {
        respondErr(conn, msg.id, { code: "unauthorized", message: "not authenticated" });
        return;
    }

    if (msg.endpoint !== LOCAL_ENDPOINT && !descriptor.routable) {
        respondErr(conn, msg.id, {
            code: "notRoutable",
            message: `${msg.method} always runs on the receiving host`,
        });
        return;
    }

    let params: unknown;
    try {
        params = descriptor.parse(msg.params);
    } catch (error) {
        if (error instanceof ValidationError) {
            respondErr(conn, msg.id, error.toProtocolError());
        } else {
            respondErr(conn, msg.id, toProtocolError(error));
        }
        return;
    }

    const controller = new AbortController();
    conn.inflight.set(msg.id, controller);

    void (async () => {
        try {
            let result: unknown;
            if (msg.endpoint === BROADCAST_ENDPOINT) {
                broadcast(msg.method, params);
                result = { dispatched: true };
            } else if (msg.endpoint === LOCAL_ENDPOINT || msg.endpoint === conn.endpoint) {
                // A manager forwards a request stamped with the remote host's own label, and
                // that host recognises it as local.
                result = await descriptor.handle(conn, params, controller.signal);
            } else {
                result = await forward(msg.endpoint, msg.method, params, controller.signal, conn);
            }
            sendRaw(conn, { t: "res", id: msg.id, ok: true, data: result });
        } catch (error) {
            if (isAbortError(error)) return; // invariant: silence after cancel
            respondErr(conn, msg.id, toProtocolError(error));
        } finally {
            conn.inflight.delete(msg.id);
        }
    })();
}
