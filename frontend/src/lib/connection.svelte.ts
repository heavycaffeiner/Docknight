import type { ClientMessage, ServerMessage } from "../../../common/protocol.ts";
import { AppError } from "../../../common/errors.ts";

export type ConnectionPhase = "idle" | "connecting" | "connected" | "authed" | "disconnected";

export interface ConnectionState {
    phase: ConnectionPhase;
    degraded: boolean;
    generation: number;
}

export const connectionState = $state<ConnectionState>({
    phase: "idle",
    degraded: false,
    generation: 0,
});

let socket: WebSocket | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (data: unknown) => void; reject: (err: unknown) => void; timer?: number }>();
const waiters: Array<{ resolve: () => void; reject: (err: unknown) => void; timer?: number }> = [];
const eventListeners = new Map<string, Set<(data: unknown, endpoint: string) => void>>();

let degradeTimer: number | undefined;
let reconnectTimer: number | undefined;
let pingInterval: number | undefined;
let lastMessageTime = 0;
let lastWakeTime = 0;

function sendRaw(msg: ClientMessage): void {
    if (socket !== null && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
    }
}

function releaseWaiters(): void {
    while (waiters.length > 0) {
        const w = waiters.shift();
        if (w !== undefined) {
            clearTimeout(w.timer);
            w.resolve();
        }
    }
}

function failWaiters(err: Error): void {
    while (waiters.length > 0) {
        const w = waiters.shift();
        if (w !== undefined) {
            clearTimeout(w.timer);
            w.reject(err);
        }
    }
}

export function connect(): void {
    if (socket !== null && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
        return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;

    connectionState.phase = "connecting";
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws`;

    try {
        socket = new WebSocket(url);
    } catch {
        handleDisconnect();
        return;
    }

    socket.onopen = () => {
        connectionState.phase = "connected";
        connectionState.generation += 1;
        connectionState.degraded = false;
        clearTimeout(degradeTimer);
        degradeTimer = undefined;
        lastMessageTime = Date.now();
        releaseWaiters();
        startPingTimer();
    };

    socket.onmessage = (event: MessageEvent<string>) => {
        lastMessageTime = Date.now();
        let msg: ServerMessage;
        try {
            msg = JSON.parse(event.data) as ServerMessage;
        } catch {
            return;
        }

        if (msg.t === "pong") {
            return;
        }

        if (msg.t === "res") {
            const req = pending.get(msg.id);
            if (req !== undefined) {
                pending.delete(msg.id);
                clearTimeout(req.timer);
                if (msg.ok) {
                    req.resolve(msg.data);
                } else {
                    req.reject(new AppError(msg.error.code, msg.error.message, msg.error.i18n, msg.error.values));
                }
            }
            return;
        }

        if (msg.t === "evt") {
            emit(msg.event, msg.data, msg.endpoint);
        }
    };

    socket.onclose = () => {
        handleDisconnect();
    };

    socket.onerror = () => {
        handleDisconnect();
    };
}

function handleDisconnect(): void {
    if (connectionState.phase === "disconnected") return;
    connectionState.phase = "disconnected";
    stopPingTimer();

    if (socket !== null) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket = null;
    }

    const err = new AppError("disconnected", "connection closed");
    for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(err);
    }
    pending.clear();
    failWaiters(err);

    if (degradeTimer === undefined) {
        degradeTimer = window.setTimeout(() => {
            connectionState.degraded = true;
        }, 2000);
    }

    if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (reconnectTimer === undefined) {
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = undefined;
                connect();
            }, 2000);
        }
    }
}

function startPingTimer(): void {
    stopPingTimer();
    pingInterval = window.setInterval(() => {
        if (socket === null || socket.readyState !== WebSocket.OPEN) return;
        sendRaw({ t: "ping" });
        const probeTime = Date.now();
        setTimeout(() => {
            if (lastMessageTime < probeTime && socket !== null) {
                socket.close(4000, "ping timeout");
            }
        }, 8000);
    }, 25000);
}

function stopPingTimer(): void {
    clearInterval(pingInterval);
    pingInterval = undefined;
}

function onWake(): void {
    const now = Date.now();
    if (now - lastWakeTime < 1000) return;
    lastWakeTime = now;

    if (socket !== null && socket.readyState === WebSocket.OPEN) {
        sendRaw({ t: "ping" });
    } else {
        connect();
    }
}

export function connectionInit(): void {
    if (typeof window === "undefined") return;
    connect();

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") onWake();
    });
    window.addEventListener("pageshow", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
}

export function disconnect(): void {
    stopPingTimer();
    if (socket !== null) {
        socket.close();
        socket = null;
    }
    connectionState.phase = "idle";
}

export function setAuthed(authed: boolean): void {
    connectionState.phase = authed ? "authed" : "connected";
}

export function request<T = unknown>(
    endpoint: string,
    method: string,
    params?: unknown,
    opts: { timeout?: number } = { timeout: 30000 },
): Promise<T> {
    const id = nextId++;
    const timeoutMs = opts.timeout ?? 30000;

    const perform = (): Promise<T> =>
        new Promise<T>((resolve, reject) => {
            let timer: number | undefined;
            if (timeoutMs > 0) {
                timer = window.setTimeout(() => {
                    sendRaw({ t: "cancel", id });
                    pending.delete(id);
                    reject(new AppError("timeout", `Request timed out: ${method}`));
                }, timeoutMs);
            }

            pending.set(id, {
                resolve: resolve as (d: unknown) => void,
                reject,
                timer,
            });

            sendRaw({ t: "req", id, endpoint, method, params });
        });

    if (connectionState.phase === "connected" || connectionState.phase === "authed") {
        return perform();
    }

    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            const idx = waiters.findIndex((w) => w.timer === timer);
            if (idx !== -1) waiters.splice(idx, 1);
            reject(new AppError("disconnected", "connection not available"));
        }, 15000);

        waiters.push({ resolve, reject, timer });
    }).then(perform);
}

export function on(event: string, handler: (data: unknown, endpoint: string) => void): () => void {
    let set = eventListeners.get(event);
    if (set === undefined) {
        set = new Set();
        eventListeners.set(event, set);
    }
    set.add(handler);

    return () => {
        const s = eventListeners.get(event);
        if (s !== undefined) {
            s.delete(handler);
            if (s.size === 0) eventListeners.delete(event);
        }
    };
}

export function emit(event: string, payload: unknown, endpoint: string = ""): void {
    const set = eventListeners.get(event);
    if (set !== undefined) {
        for (const handler of set) {
            try {
                handler(payload, endpoint);
            } catch (err) {
                console.error(`Error in event listener for "${event}":`, err);
            }
        }
    }
}
