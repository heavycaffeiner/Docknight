import { RequestError } from "$common/errors.ts";
import {
    DEFAULT_REQUEST_TIMEOUT_MS,
    METHOD_FLAGS,
    isProtocolError,
    type EventName,
    type EventPayload,
    type MethodName,
    type MethodParams,
    type MethodResult,
    type ServerMessage,
} from "$common/protocol.ts";

export type ConnectionState = "connecting" | "connected" | "disconnected";

/**
 * Gap between reconnection attempts while the app is in front. It does not grow: a backgrounded app
 * schedules nothing at all, so the delay never has a chance to drift out to half a minute while the
 * phone is asleep.
 */
const RECONNECT_MS = 2_000;

/** How long a request waits for a usable socket before it gives up instead of being sent. */
const SEND_WAIT_MS = 15_000;
/** Silence is probed rather than trusted, because a socket can outlive the network under it. */
const HEARTBEAT_MS = 25_000;
/** A probe unanswered for this long means the socket is half open. */
const PROBE_TIMEOUT_MS = 8_000;
/** Waking a phone fires several resume signals at once; they are one event. */
const RESUME_THROTTLE_MS = 1_000;
/** A drop shorter than this never reaches the banner. */
const BANNER_GRACE_MS = 2_000;

interface Pending {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    timer: number | null;
}

interface Waiter {
    needsAuth: boolean;
    resolve: () => void;
    timer: number;
}

type Handler = (endpoint: string, data: unknown) => void;

export const connection = $state<{
    state: ConnectionState;
    everConnected: boolean;
    /** The drop has lasted long enough to be worth telling the user about. */
    degraded: boolean;
    /** Bumped once each new socket is usable, so views can rejoin what lives on the server. */
    generation: number;
}>({ state: "connecting", everConnected: false, degraded: false, generation: 0 });

let socket: WebSocket | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const handlers = new Map<string, Set<Handler>>();
let waiters: Waiter[] = [];
let retryTimer: number | null = null;
let degradedTimer: number | null = null;
let heartbeatTimer: number | null = null;
let probeTimer: number | null = null;
let lastConnectAt = 0;
let lastResumeAt = 0;
let handshakeDone = false;
let closedByClient = false;
let onOpenHook: (() => Promise<void> | void) | null = null;

/**
 * Called after every socket open. Requests that need authentication wait for the returned promise,
 * so a reconnect cannot race the session being restored.
 */
export function onOpen(hook: () => Promise<void> | void): void {
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

function sendable(needsAuth: boolean): boolean {
    if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
    return handshakeDone || !needsAuth;
}

function releaseWaiters(): void {
    if (waiters.length === 0) return;
    const held: Waiter[] = [];
    const ready: Waiter[] = [];
    for (const waiter of waiters) (sendable(waiter.needsAuth) ? ready : held).push(waiter);
    waiters = held;
    for (const waiter of ready) {
        clearTimeout(waiter.timer);
        waiter.resolve();
    }
}

/**
 * Resolve once a frame may go out, which is what makes a blip invisible: a request made while the
 * socket is down is held rather than failed. Nothing is retried this way, because nothing has been
 * sent yet.
 */
function awaitSendable(needsAuth: boolean): Promise<void> {
    if (sendable(needsAuth)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            waiters = waiters.filter((waiter) => waiter.timer !== timer);
            reject(new RequestError("disconnected", "not connected", { i18n: "errorDisconnected" }));
        }, SEND_WAIT_MS);
        waiters.push({ needsAuth, resolve, timer });
    });
}

function setDegraded(value: boolean): void {
    if (degradedTimer !== null) clearTimeout(degradedTimer);
    degradedTimer = null;
    if (!value) {
        connection.degraded = false;
        return;
    }
    if (connection.degraded) return;
    degradedTimer = window.setTimeout(() => {
        degradedTimer = null;
        connection.degraded = true;
    }, BANNER_GRACE_MS);
}

function clearRetry(): void {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
}

function scheduleReconnect(): void {
    // Nothing is scheduled while the app is away. A backgrounded tab has its timers throttled and a
    // sleeping phone runs none at all, so a timer set here would fire at an arbitrary time or not at
    // all; coming back to the front is what reconnects it.
    if (retryTimer !== null || document.visibilityState !== "visible") return;
    retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
    }, RECONNECT_MS);
}

function stopHeartbeat(): void {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (probeTimer !== null) clearTimeout(probeTimer);
    probeTimer = null;
}

function handleGone(current: WebSocket): void {
    if (socket !== current) return;
    socket = null;
    handshakeDone = false;
    stopHeartbeat();
    connection.state = "disconnected";
    setDegraded(true);
    // Pending requests are rejected, never silently retried: a mutation that was in flight may
    // or may not have run.
    rejectAllPending();
    scheduleReconnect();
}

/**
 * Ask the server to say something, and drop the socket if it will not. A connection that survived
 * the network moving underneath it stays open with nothing on the other end, and the pong the
 * browser answers with is invisible from here.
 */
function probe(): void {
    const current = socket;
    if (current === null || current.readyState !== WebSocket.OPEN) return;
    try {
        current.send(JSON.stringify({ t: "ping" }));
    } catch {
        handleGone(current);
        return;
    }
    if (probeTimer !== null) return;
    probeTimer = window.setTimeout(() => {
        probeTimer = null;
        handleGone(current);
        current.close(4000, "no answer to a liveness probe");
    }, PROBE_TIMEOUT_MS);
}

/** The app came back to the front. This is the main way a dropped socket is replaced on a phone. */
function resumeNow(): void {
    if (closedByClient) return;
    const now = Date.now();
    if (now - lastResumeAt < RESUME_THROTTLE_MS) return;
    lastResumeAt = now;

    const current = socket;
    if (current !== null && current.readyState === WebSocket.OPEN) {
        probe();
        return;
    }
    if (current !== null && current.readyState === WebSocket.CONNECTING) {
        // A connect started before the device slept can sit here for minutes. Give it the probe
        // window from now, then start a fresh one.
        if (now - lastConnectAt < PROBE_TIMEOUT_MS) return;
        handleGone(current);
        current.close(4000, "connect stalled");
    }
    connect();
}

export function connect(): void {
    closedByClient = false;
    if (socket !== null && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }
    clearRetry();
    lastConnectAt = Date.now();
    connection.state = "connecting";

    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const next = new WebSocket(`${scheme}//${location.host}/ws`);
    socket = next;

    next.addEventListener("open", () => {
        if (socket !== next) return;
        connection.state = "connected";
        connection.everConnected = true;
        setDegraded(false);
        stopHeartbeat();
        heartbeatTimer = window.setInterval(probe, HEARTBEAT_MS);
        // Login and token resume may go out now; everything else waits for the hook below.
        releaseWaiters();
        void settle(next);
    });

    next.addEventListener("message", (event: MessageEvent<string>) => {
        if (probeTimer !== null) clearTimeout(probeTimer);
        probeTimer = null;

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

    const onGone = (): void => handleGone(next);
    next.addEventListener("close", onGone);
    next.addEventListener("error", onGone);
}

async function settle(current: WebSocket): Promise<void> {
    try {
        await onOpenHook?.();
    } catch {
        // A failed resume still opens the gate: the login screen needs the socket too.
    }
    if (socket !== current) return;
    handshakeDone = true;
    connection.generation += 1;
    releaseWaiters();
}

export function disconnect(code = 1000): void {
    closedByClient = true;
    clearRetry();
    stopHeartbeat();
    setDegraded(false);
    handshakeDone = false;
    const current = socket;
    socket = null;
    rejectAllPending();
    current?.close(code, "client closing");
    connection.state = "disconnected";
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumeNow();
    else clearRetry();
});
window.addEventListener("pageshow", resumeNow);
window.addEventListener("focus", resumeNow);
window.addEventListener("online", resumeNow);

/**
 * Send a request and resolve with its result. A request made while the socket is down waits for
 * the reconnect; the deadline below starts once the frame actually goes out.
 *
 * @param endpoint "" for this host, "host:port" for one remote host, "*" to broadcast.
 * @param opts.timeout Milliseconds before local rejection. 0 disables the deadline.
 */
export async function request<M extends MethodName>(
    endpoint: string,
    method: M,
    params: MethodParams<M>,
    opts?: { timeout?: number },
): Promise<MethodResult<M>> {
    await awaitSendable(METHOD_FLAGS[method].auth);

    const current = socket;
    if (current === null || current.readyState !== WebSocket.OPEN) {
        throw new RequestError("disconnected", "not connected", { i18n: "errorDisconnected" });
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
