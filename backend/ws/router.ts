import { RequestError, ValidationError, isAbortError } from "../../common/errors.ts";
import {
    BROADCAST_ENDPOINT,
    LOCAL_ENDPOINT,
    METHOD_FLAGS,
    type ClientMessage,
    type MethodName,
    type ProtocolError,
} from "../../common/protocol.ts";
import { log } from "../log.ts";
import type { Conn } from "./conn.ts";

export interface Descriptor<P, R> {
    requiresAuth: boolean;
    routable: boolean;
    /** Validates and narrows the untrusted params object, throwing ValidationError on mismatch. */
    parse: (raw: unknown) => P;
    handle: (conn: Conn, params: P, signal: AbortSignal) => Promise<R> | R;
}

const METHODS = new Map<string, Descriptor<unknown, unknown>>();

/** Forwarding hooks, filled in by the agent pool at startup. */
let forward: ((endpoint: string, method: string, params: unknown, signal: AbortSignal) => Promise<unknown>) | null =
    null;
let broadcast: ((method: string, params: unknown) => void) | null = null;

export function setForwarder(
    fn: (endpoint: string, method: string, params: unknown, signal: AbortSignal) => Promise<unknown>,
): void {
    forward = fn;
}

export function setBroadcaster(fn: (method: string, params: unknown) => void): void {
    broadcast = fn;
}

/**
 * Register one method. The declared flags are asserted against the routing table in
 * `common/protocol.ts`, so a handler cannot silently disagree with the documented contract.
 */
export function method<P, R>(name: MethodName, descriptor: Descriptor<P, R>): void {
    const flags = METHOD_FLAGS[name];
    if (flags.auth !== descriptor.requiresAuth || flags.route !== descriptor.routable) {
        throw new Error(
            `${name}: declared flags disagree with METHOD_FLAGS ` +
                `(auth ${String(descriptor.requiresAuth)} vs ${String(flags.auth)}, ` +
                `route ${String(descriptor.routable)} vs ${String(flags.route)})`,
        );
    }
    if (METHODS.has(name)) throw new Error(`${name} is registered twice`);
    METHODS.set(name, descriptor as Descriptor<unknown, unknown>);
}

export function registeredMethods(): readonly string[] {
    return [...METHODS.keys()];
}

/** Map any thrown value onto a wire error, logging the ones that carry no protocol meaning. */
export function toProtocolError(error: unknown, connId: string, methodName: string): ProtocolError {
    if (error instanceof RequestError) return error.toProtocolError();
    if (error instanceof ValidationError) {
        return { code: "invalidParams", message: `${error.field}: ${error.message}` };
    }
    log.error("ws", `${connId} ${methodName} failed`, error);
    return { code: "internal", message: "internal error" };
}

function sendError(conn: Conn, id: number, error: ProtocolError): void {
    conn.send({ t: "res", id, ok: false, error });
}

export async function dispatch(conn: Conn, msg: ClientMessage): Promise<void> {
    if (msg.t === "cancel") {
        conn.inflight.get(msg.id)?.abort();
        return;
    }

    if (conn.inflight.has(msg.id)) {
        sendError(conn, msg.id, {
            code: "duplicateRequestId",
            message: `request id ${msg.id} is already in flight`,
        });
        return;
    }

    const descriptor = METHODS.get(msg.method);
    if (descriptor === undefined) {
        sendError(conn, msg.id, { code: "unknownMethod", message: `no method ${msg.method}` });
        return;
    }

    if (descriptor.requiresAuth && conn.userId === null) {
        sendError(conn, msg.id, { code: "unauthorized", message: "not authenticated" });
        return;
    }

    if (msg.endpoint !== LOCAL_ENDPOINT && !descriptor.routable) {
        sendError(conn, msg.id, {
            code: "notRoutable",
            message: `${msg.method} always runs on the receiving host`,
        });
        return;
    }

    let params: unknown;
    try {
        params = descriptor.parse(msg.params);
    } catch (error) {
        sendError(conn, msg.id, toProtocolError(error, conn.id, msg.method));
        return;
    }

    const controller = new AbortController();
    conn.inflight.set(msg.id, controller);
    try {
        let result: unknown;
        if (msg.endpoint === BROADCAST_ENDPOINT) {
            broadcast?.(msg.method, params);
            result = { dispatched: true };
        } else if (msg.endpoint === LOCAL_ENDPOINT || msg.endpoint === conn.endpoint) {
            // A manager forwards a request stamped with the remote host's own label, and that
            // host recognises it as local.
            result = await descriptor.handle(conn, params, controller.signal);
        } else if (forward === null) {
            throw new RequestError("agentUnreachable", `no link to ${msg.endpoint}`, {
                i18n: "agentUnreachable",
            });
        } else {
            result = await forward(msg.endpoint, msg.method, params, controller.signal);
        }
        if (!conn.closed) conn.send({ t: "res", id: msg.id, ok: true, data: result });
    } catch (error) {
        if (isAbortError(error)) return; // The client asked; stay silent.
        sendError(conn, msg.id, toProtocolError(error, conn.id, msg.method));
    } finally {
        conn.inflight.delete(msg.id);
    }
}
