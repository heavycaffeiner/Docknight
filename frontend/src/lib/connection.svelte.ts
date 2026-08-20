import {
    AppError,
    isAbortError,
} from "../../../common/errors.ts";
import {
    isProtocolError,
    type ClientMessage,
    type EventName,
    type EventPayload,
    type MethodName,
    type MethodParams,
    type MethodResult,
    type ServerMessage,
} from "../../../common/protocol.ts";

export type ConnectionState = "connecting" | "connected" | "needLogin" | "disconnected";

const HOLD_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const PING_INTERVAL_MS = 25_000;
const PONG_GRACE_MS = 8_000;
const DEGRADED_GRACE_MS = 2_000;
const WAKE_THROTTLE_MS = 1_000;

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
}

const state = $state<{
    connectionState: ConnectionState;
    degraded: boolean;
    generation: number;
}>({ connectionState: "connecting", degraded: false, generation: 0 });

export const connectionState: { readonly value: ConnectionState } = {
    get value() {
        return state.connectionState;
    },
};

/** True once a drop has outlasted a 2 s grace, so a reconnect the user never noticed stays silent. */
export const degraded: { readonly value: boolean } = {
    get value() {
        return state.degraded;
    },
};

/** Bumped once per settled socket. Views keyed on it re-issue their joins. */
export const generation: { readonly value: number } = {
    get value() {
        return state.generation;
    },
};

let socket: WebSocket | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();
const eventHandlers = new Map<string, Set<(endpoint: string, data: unknown) => void>>();

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pongDeadline: ReturnType<typeof setTimeout> | null = null;
let degradedTimer: ReturnType<typeof setTimeout> | null = null;
let lastWakeAt = 0;
let hasEverConnected = false;
let started = false;

/** A request awaiting a usable socket, resolved or rejected once one opens or the hold expires. */
const holdQueue: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

function wsUrl(): string {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${location.host}/ws`;
}

function clearPingTimers(): void {
    if (pingTimer !== null) clearInterval(pingTimer);
    if (pongDeadline !== null) clearTimeout(pongDeadline);
    pingTimer = null;
    pongDeadline = null;
}

function rejectAllPending(error: unknown): void {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
    for (const h of holdQueue.splice(0, holdQueue.length)) h.reject(error);
}

function setDegradedAfterGrace(): void {
    if (degradedTimer !== null) clearTimeout(degradedTimer);
    degradedTimer = setTimeout(() => {
        state.degraded = true;
    }, DEGRADED_GRACE_MS);
}

function clearDegraded(): void {
    if (degradedTimer !== null) clearTimeout(degradedTimer);
    degradedTimer = null;
    state.degraded = false;
}

function resolveHoldQueue(): void {
    for (const h of holdQueue.splice(0, holdQueue.length)) h.resolve();
}

function scheduleRetry(): void {
    if (retryTimer !== null) return;
    if (document.visibilityState !== "visible") return; // nothing scheduled while hidden
    retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
    }, RETRY_DELAY_MS);
}

function emit(event: string, endpoint: string, data: unknown): void {
    for (const handler of eventHandlers.get(event) ?? []) handler(endpoint, data);
}

function tokenStorage(): Storage {
    return localStorage.getItem("remember") === "1" ? localStorage : sessionStorage;
}

async function onOpen(activeSocket: WebSocket): Promise<void> {
    clearDegraded();
    startPing(activeSocket);
    const token = localStorage.getItem("token") ?? sessionStorage.getItem("token");
    if (token !== null && token !== "") {
        try {
            await request("", "auth.loginByToken", { token } as never);
            state.connectionState = "connected";
        } catch {
            localStorage.removeItem("token");
            sessionStorage.removeItem("token");
            state.connectionState = "needLogin";
        }
    } else {
        state.connectionState = "needLogin";
    }
    hasEverConnected = true;
    state.generation += 1;
    resolveHoldQueue();
}

function startPing(activeSocket: WebSocket): void {
    clearPingTimers();
    pingTimer = setInterval(() => {
        if (activeSocket.readyState !== WebSocket.OPEN) return;
        activeSocket.send(JSON.stringify({ t: "ping" } satisfies ClientMessage));
        if (pongDeadline !== null) clearTimeout(pongDeadline);
        pongDeadline = setTimeout(() => {
            activeSocket.close(4000, "no pong within grace");
        }, PONG_GRACE_MS);
    }, PING_INTERVAL_MS);
}

function onMessage(raw: string): void {
    let msg: ServerMessage;
    try {
        msg = JSON.parse(raw) as ServerMessage;
    } catch {
        return;
    }
    if (msg.t === "pong") {
        if (pongDeadline !== null) clearTimeout(pongDeadline);
        pongDeadline = null;
        return;
    }
    if (msg.t === "evt") {
        emit(msg.event, msg.endpoint, msg.data);
        return;
    }
    if (msg.t === "res") {
        const p = pending.get(msg.id);
        if (p === undefined) return;
        pending.delete(msg.id);
        if (msg.ok) {
            p.resolve(msg.data);
        } else {
            const err = isProtocolError(msg.error) ? msg.error : { code: "internal" as const, message: "malformed error" };
            p.reject(new AppError(err.code, err.message, err.i18n, err.values));
        }
    }
}

function connect(): void {
    if (socket !== null && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }
    state.connectionState = "connecting";
    const activeSocket = new WebSocket(wsUrl());
    socket = activeSocket;

    activeSocket.addEventListener("open", () => {
        void onOpen(activeSocket);
    });
    activeSocket.addEventListener("message", (event: MessageEvent<string>) => onMessage(event.data));
    activeSocket.addEventListener("close", () => {
        if (socket === activeSocket) socket = null;
        clearPingTimers();
        state.connectionState = "disconnected";
        rejectAllPending(new AppError("disconnected", "the connection was lost"));
        if (hasEverConnected) setDegradedAfterGrace();
        scheduleRetry();
    });
    activeSocket.addEventListener("error", () => {
        // The "close" event follows and drives reconnection; nothing extra to do here.
    });
}

/** Resolve once a socket is open (not necessarily authenticated), or reject after the hold timeout. */
function waitForOpenSocket(): Promise<void> {
    if (socket !== null && socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const entry = { resolve, reject };
        holdQueue.push(entry);
        const timer = setTimeout(() => {
            const index = holdQueue.indexOf(entry);
            if (index !== -1) holdQueue.splice(index, 1);
            reject(new AppError("disconnected", "no connection became available in time"));
        }, HOLD_TIMEOUT_MS);
        const originalResolve = entry.resolve;
        entry.resolve = () => {
            clearTimeout(timer);
            originalResolve();
        };
        const originalReject = entry.reject;
        entry.reject = (error: unknown) => {
            clearTimeout(timer);
            originalReject(error);
        };
        connect();
    });
}

/**
 * Send a request and resolve with its result. Waits up to 15 s for a usable socket when
 * disconnected. A request against a gated method also implicitly waits for the socket to
 * open, since the caller only reaches here after `onOpen`'s handshake or with a method that
 * does not require it.
 *
 * @throws AppError on a server error, a local timeout, or a disconnect that outlasts the hold.
 */
export async function request<M extends MethodName>(
    endpoint: string,
    method: M,
    params: MethodParams<M>,
    opts?: { timeout?: number },
): Promise<MethodResult<M>> {
    await waitForOpenSocket();
    const activeSocket = socket;
    if (activeSocket === null || activeSocket.readyState !== WebSocket.OPEN) {
        throw new AppError("disconnected", "the connection was lost");
    }

    const id = nextId;
    nextId += 1;
    const timeoutMs = opts?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return new Promise<MethodResult<M>>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void): void => {
            if (settled) return;
            settled = true;
            pending.delete(id);
            if (deadline !== null) clearTimeout(deadline);
            fn();
        };
        const deadline =
            timeoutMs > 0
                ? setTimeout(() => {
                      activeSocket.send(JSON.stringify({ t: "cancel", id } satisfies ClientMessage));
                      finish(() => reject(new AppError("timeout", "the request timed out")));
                  }, timeoutMs)
                : null;

        pending.set(id, {
            resolve: (value) => finish(() => resolve(value as MethodResult<M>)),
            reject: (error) => finish(() => reject(error as Error)),
        });

        activeSocket.send(
            JSON.stringify({ t: "req", id, endpoint, method, params } satisfies ClientMessage),
        );
    });
}

/** Subscribe to a server event. Returns an unsubscribe function. */
export function on<E extends EventName>(
    event: E,
    handler: (endpoint: string, data: EventPayload<E>) => void,
): () => void {
    const set = eventHandlers.get(event) ?? new Set();
    eventHandlers.set(event, set);
    const wrapped = handler as (endpoint: string, data: unknown) => void;
    set.add(wrapped);
    return () => {
        set.delete(wrapped);
    };
}

function wake(): void {
    const now = Date.now();
    if (now - lastWakeAt < WAKE_THROTTLE_MS) return;
    lastWakeAt = now;
    if (socket === null || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        connect();
        return;
    }
    if (socket.readyState === WebSocket.OPEN && pingTimer !== null) {
        // A live socket: send an out-of-cycle ping to confirm it still works instead of
        // waiting for the next scheduled one.
        socket.send(JSON.stringify({ t: "ping" } satisfies ClientMessage));
    }
}

/** Begin the connection lifecycle: initial connect, keepalive, and wake handlers. Idempotent. */
export function connectionInit(): void {
    if (started) return;
    started = true;
    connect();
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") wake();
    });
    window.addEventListener("pageshow", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
}

export function isConnectionAbortError(error: unknown): boolean {
    return isAbortError(error);
}

/** Where the session token is persisted: localStorage under remember-me, sessionStorage otherwise. */
export { tokenStorage };
