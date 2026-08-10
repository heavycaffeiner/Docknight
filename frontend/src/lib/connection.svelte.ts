import { RequestError } from "$common/errors.ts";
import {
    DEFAULT_REQUEST_TIMEOUT_MS,
    isProtocolError,
    type EventName,
    type EventPayload,
    type MethodName,
    type MethodParams,
    type MethodResult,
    type ServerMessage,
} from "$common/protocol.ts";

export type ConnectionState = "connecting" | "connected" | "disconnected";

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;
const JITTER_MS = 500;

interface Pending {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    timer: number | null;
}

type Handler = (endpoint: string, data: unknown) => void;

export const connection = $state<{
    state: ConnectionState;
    /** Seconds until the next reconnection attempt, for the banner countdown. */
    retryIn: number;
    everConnected: boolean;
}>({ state: "connecting", retryIn: 0, everConnected: false });

let socket: WebSocket | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const handlers = new Map<string, Set<Handler>>();
let attempt = 0;
let retryTimer: number | null = null;
let countdownTimer: number | null = null;
let onOpenHook: (() => void) | null = null;

/** Called after every successful socket open, so the session store can resume or ask for login. */
export function onOpen(hook: () => void): void {
    onOpenHook = hook;
}

function rejectAllPending(): void {
    const entries = [...pending.values()];
    pending.clear();
    for (const entry of entries) {
        if (entry.timer !== null) clearTimeout(entry.timer);
        entry.reject(
            new RequestError("disconnected", "the connection closed while the request was in flight", {
                i18n: "errorDisconnected",
            }),
        );
    }
}

function dispatchEvent(message: Extract<ServerMessage, { t: "evt" }>): void {
    const set = handlers.get(message.event);
    if (set === undefined) return;
    for (const handler of [...set]) handler(message.endpoint, message.data);
}

function scheduleReconnect(): void {
    if (retryTimer !== null) return;
    attempt += 1;
    const delay =
        Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1)) +
        Math.floor(Math.random() * JITTER_MS);

    connection.retryIn = Math.ceil(delay / 1000);
    if (countdownTimer !== null) clearInterval(countdownTimer);
    countdownTimer = window.setInterval(() => {
        connection.retryIn = Math.max(0, connection.retryIn - 1);
    }, 1000);

    retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (countdownTimer !== null) clearInterval(countdownTimer);
        countdownTimer = null;
        connection.retryIn = 0;
        connect();
    }, delay);
}

export function connect(): void {
    if (socket !== null && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }
    connection.state = "connecting";

    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const next = new WebSocket(`${scheme}//${location.host}/ws`);
    socket = next;

    next.addEventListener("open", () => {
        attempt = 0;
        connection.state = "connected";
        connection.everConnected = true;
        onOpenHook?.();
    });

    next.addEventListener("message", (event: MessageEvent<string>) => {
        let message: ServerMessage;
        try {
            message = JSON.parse(event.data) as ServerMessage;
        } catch {
            return;
        }
        if (message.t === "evt") {
            dispatchEvent(message);
            return;
        }
        if (message.t !== "res") return;

        const entry = pending.get(message.id);
        if (entry === undefined) return;
        pending.delete(message.id);
        if (entry.timer !== null) clearTimeout(entry.timer);

        if (message.ok) entry.resolve(message.data);
        else
            entry.reject(
                new RequestError(message.error.code, message.error.message, {
                    i18n: message.error.i18n,
                    values: message.error.values,
                }),
            );
    });

    const onGone = (): void => {
        if (socket !== next) return;
        socket = null;
        connection.state = "disconnected";
        // Pending requests are rejected, never silently retried: a mutation that was in flight may
        // or may not have run.
        rejectAllPending();
        scheduleReconnect();
    };

    next.addEventListener("close", onGone);
    next.addEventListener("error", onGone);
}

export function disconnect(code = 1000): void {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    if (countdownTimer !== null) clearInterval(countdownTimer);
    countdownTimer = null;
    const current = socket;
    socket = null;
    rejectAllPending();
    current?.close(code, "client closing");
    connection.state = "disconnected";
}

/**
 * Send a request and resolve with its result.
 *
 * @param endpoint "" for this host, "host:port" for one remote host, "*" to broadcast.
 * @param opts.timeout Milliseconds before local rejection. 0 disables the deadline.
 */
export function request<M extends MethodName>(
    endpoint: string,
    method: M,
    params: MethodParams<M>,
    opts?: { timeout?: number },
): Promise<MethodResult<M>> {
    const current = socket;
    if (current === null || current.readyState !== WebSocket.OPEN) {
        return Promise.reject(
            new RequestError("disconnected", "not connected", { i18n: "errorDisconnected" }),
        );
    }

    const id = nextId++;
    const timeout = opts?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return new Promise<MethodResult<M>>((resolve, reject) => {
        const timer =
            timeout > 0
                ? window.setTimeout(() => {
                      pending.delete(id);
                      // Tell the server it can stop work nobody is waiting for.
                      try {
                          current.send(JSON.stringify({ t: "cancel", id }));
                      } catch {
                          // The socket is already gone.
                      }
                      reject(
                          new RequestError("timeout", `${method} did not answer in ${timeout} ms`, {
                              i18n: "errorTimeout",
                          }),
                      );
                  }, timeout)
                : null;

        pending.set(id, {
            resolve: resolve as (value: unknown) => void,
            reject,
            timer,
        });

        const frame: Record<string, unknown> = { t: "req", id, endpoint, method };
        if (params !== undefined) frame.params = params;
        current.send(JSON.stringify(frame));
    });
}

/** Subscribe to a server event. Returns an unsubscribe function. */
export function on<E extends EventName>(
    event: E,
    handler: (endpoint: string, data: EventPayload<E>) => void,
): () => void {
    const set = handlers.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    handlers.set(event, set);
    return () => {
        set.delete(handler as Handler);
    };
}

export function describeError(error: unknown): { code: string; i18n?: string; message: string } {
    if (error instanceof RequestError) {
        return {
            code: error.code,
            ...(error.i18n === undefined ? {} : { i18n: error.i18n }),
            message: error.message,
        };
    }
    if (isProtocolError(error)) {
        return {
            code: error.code,
            ...(error.i18n === undefined ? {} : { i18n: error.i18n }),
            message: error.message,
        };
    }
    return { code: "internal", message: error instanceof Error ? error.message : String(error) };
}
