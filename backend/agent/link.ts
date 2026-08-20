import { WebSocket } from "ws";
import { isAbortError, AppError } from "../../common/errors.ts";
import {
    HEADER_ENDPOINT,
    HEADER_PROTOCOL,
    LOCAL_ENDPOINT,
    PROTOCOL_VERSION,
    isProtocolError,
    type ClientMessage,
    type ProtocolError,
    type ServerMessage,
} from "../../common/protocol.ts";
import { log } from "../log.ts";
import { decryptSecret } from "./crypto.ts";
import { deriveEndpoint, type AgentRow } from "./store.ts";

export type LinkState = "connecting" | "authenticating" | "online" | "backoff" | "failed" | "closed";

const KEEPALIVE_PING_MS = 20_000;
const KEEPALIVE_TIMEOUT_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;
const REQUEST_TIMEOUT_MS = 60_000;

interface PendingForward {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
}

export interface LinkDeps {
    key: Buffer;
    /** Called on every state transition and status-relevant socket event. */
    onStatus: (status: "connecting" | "online" | "offline", message?: string) => void;
    /** Called with every inbound event frame, for the pool to relay onward. */
    onEvent: (message: Extract<ServerMessage, { t: "evt" }>) => void;
    wsUrl: (agent: AgentRow) => string;
    /** Overrides for tests; production uses the module constants. */
    maxBackoffMs?: number;
}

export interface Link {
    readonly state: LinkState;
    request(method: string, params: unknown, signal: AbortSignal | null, timeoutMs: number): Promise<unknown>;
    waitOnline(ms: number): Promise<boolean>;
    /** Removal or shutdown; cancels retries and rejects every pending forward. */
    close(): void;
}

/** One outbound connection to a managed host, with reconnect backoff per proposal 5 section 4.3.1. */
export function createLink(agent: AgentRow, deps: LinkDeps): Link {
    let state: LinkState = "connecting";
    let socket: WebSocket | null = null;
    let nextId = 1;
    let backoffStep = 0;
    let retryTimer: NodeJS.Timeout | null = null;
    let keepaliveTimer: NodeJS.Timeout | null = null;
    let lastPongAt = Date.now();
    let closed = false;
    const pendingForwards = new Map<number, PendingForward>();
    const stateWaiters: Array<() => void> = [];

    function setState(next: LinkState): void {
        state = next;
        const waiters = stateWaiters.splice(0, stateWaiters.length);
        for (const waiter of waiters) waiter();
    }

    function rejectAllPending(error: unknown): void {
        for (const pending of pendingForwards.values()) pending.reject(error);
        pendingForwards.clear();
    }

    function teardownSocket(): void {
        if (keepaliveTimer !== null) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
        }
        socket = null;
    }

    function scheduleRetry(): void {
        if (closed) return;
        const cap = deps.maxBackoffMs ?? MAX_BACKOFF_MS;
        const delay = Math.min(cap, 1000 * 2 ** backoffStep) + Math.floor(Math.random() * 1000);
        backoffStep += 1;
        retryTimer = setTimeout(() => void connect(), delay);
        retryTimer.unref();
    }

    function fail(reason: string): void {
        setState("failed");
        deps.onStatus("offline", reason);
        // Failed leaves only when the caller replaces this link (agent.add re-adding the
        // record, or an edit); no timer is scheduled here.
    }

    function rawRequest(
        method: string,
        params: unknown,
        signal: AbortSignal | null,
        timeoutMs: number,
    ): Promise<unknown> {
        const activeSocket = socket;
        if (activeSocket === null || activeSocket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new AppError("agentUnreachable", "the link is not connected", "agentUnreachable"));
        }
        const id = nextId;
        nextId += 1;
        const frame: ClientMessage = { t: "req", id, endpoint: LOCAL_ENDPOINT, method, params };

        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (fn: () => void): void => {
                if (settled) return;
                settled = true;
                pendingForwards.delete(id);
                if (deadline !== null) clearTimeout(deadline);
                if (signal !== null) signal.removeEventListener("abort", onAbort);
                fn();
            };

            const onAbort = (): void => {
                try {
                    activeSocket.send(JSON.stringify({ t: "cancel", id } satisfies ClientMessage));
                } catch {
                    // The socket may already be gone; the pending entry is cleared regardless.
                }
                finish(() => reject(new DOMException("aborted", "AbortError")));
            };
            if (signal !== null) signal.addEventListener("abort", onAbort);

            const deadline =
                timeoutMs > 0
                    ? setTimeout(() => {
                          finish(() => reject(new AppError("agentTimeout", "the host did not answer in time", "agentTimeout")));
                      }, timeoutMs)
                    : null;
            if (deadline !== null) deadline.unref();

            pendingForwards.set(id, {
                resolve: (value) => finish(() => resolve(value)),
                reject: (error) => finish(() => reject(error)),
            });

            try {
                activeSocket.send(JSON.stringify(frame));
            } catch (error) {
                finish(() => reject(error));
            }
        });
    }

    function handleMessage(raw: Buffer): void {
        let message: ServerMessage;
        try {
            message = JSON.parse(raw.toString("utf8")) as ServerMessage;
        } catch {
            return; // malformed frame from an otherwise-authenticated peer; ignore rather than tear down
        }
        if (message.t === "evt") {
            deps.onEvent(message);
            return;
        }
        if (message.t === "res") {
            const pending = pendingForwards.get(message.id);
            if (pending === undefined) return;
            if (message.ok) {
                pending.resolve(message.data);
            } else {
                pending.reject(protocolErrorToAppError(message.error));
            }
        }
    }

    function startKeepalive(activeSocket: WebSocket): void {
        lastPongAt = Date.now();
        activeSocket.on("pong", () => {
            lastPongAt = Date.now();
        });
        keepaliveTimer = setInterval(() => {
            if (Date.now() - lastPongAt > KEEPALIVE_TIMEOUT_MS) {
                activeSocket.terminate();
                return;
            }
            activeSocket.ping();
        }, KEEPALIVE_PING_MS);
        keepaliveTimer.unref();
    }

    async function connect(): Promise<void> {
        if (closed) return;
        setState("connecting");
        deps.onStatus("connecting");

        const activeSocket = new WebSocket(deps.wsUrl(agent), {
            headers: {
                [HEADER_ENDPOINT]: deriveEndpoint(agent.url),
                [HEADER_PROTOCOL]: String(PROTOCOL_VERSION),
            },
        });
        socket = activeSocket;

        activeSocket.on("unexpected-response", (_request, response) => {
            activeSocket.terminate();
            fail(
                response.statusCode === 400
                    ? "unsupported protocol version"
                    : `unexpected response ${response.statusCode ?? 0}`,
            );
        });

        activeSocket.on("open", () => {
            void onOpen(activeSocket);
        });

        activeSocket.on("message", (raw: Buffer) => handleMessage(raw));

        activeSocket.on("close", () => {
            teardownSocket();
            rejectAllPending(new AppError("agentUnreachable", "the link closed", "agentUnreachable"));
            if (state === "failed" || state === "closed") return;
            setState("backoff");
            deps.onStatus("offline", "connection refused");
            scheduleRetry();
        });

        activeSocket.on("error", () => {
            // The "close" handler runs after this and drives the retry; nothing extra to do.
        });
    }

    async function onOpen(activeSocket: WebSocket): Promise<void> {
        setState("authenticating");
        let password: string;
        try {
            password = decryptSecret(deps.key, agent.secret);
        } catch (error) {
            activeSocket.close();
            fail("stored credentials could not be decrypted");
            log.error("agent", `${agent.url} credential decryption failed`, error);
            return;
        }

        let loginResult: unknown;
        try {
            loginResult = await rawRequest(
                "auth.login",
                { username: agent.username, password },
                null,
                REQUEST_TIMEOUT_MS,
            );
        } catch {
            activeSocket.close();
            fail("authentication failed");
            return;
        }
        if (
            typeof loginResult !== "object" ||
            loginResult === null ||
            !("token" in loginResult)
        ) {
            activeSocket.close();
            fail("authentication failed");
            return;
        }

        setState("online");
        deps.onStatus("online");
        backoffStep = 0;
        startKeepalive(activeSocket);

        try {
            const stackList = await rawRequest("stack.list", undefined, null, REQUEST_TIMEOUT_MS);
            deps.onEvent({ t: "evt", endpoint: LOCAL_ENDPOINT, event: "stackList", data: stackList });
        } catch (error) {
            log.warn("agent", `${agent.url} failed to prime the stack list`, error);
        }
    }

    function protocolErrorToAppError(error: ProtocolError): AppError {
        if (isProtocolError(error)) return new AppError(error.code, error.message, error.i18n, error.values);
        return new AppError("internal", "the host returned a malformed error");
    }

    function request(
        method: string,
        params: unknown,
        signal: AbortSignal | null,
        timeoutMs: number,
    ): Promise<unknown> {
        return rawRequest(method, params, signal, timeoutMs);
    }

    function waitOnline(ms: number): Promise<boolean> {
        if (state === "online") return Promise.resolve(true);
        if (state === "failed" || state === "closed") return Promise.resolve(false);
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve(state === "online");
            }, ms);
            timer.unref();
            const waiter = (): void => {
                if (settled) return;
                if (state === "online" || state === "failed" || state === "closed") {
                    settled = true;
                    clearTimeout(timer);
                    resolve(state === "online");
                    return;
                }
                stateWaiters.push(waiter);
            };
            stateWaiters.push(waiter);
        });
    }

    function close(): void {
        closed = true;
        setState("closed");
        if (retryTimer !== null) clearTimeout(retryTimer);
        teardownSocket();
        rejectAllPending(new AppError("agentUnreachable", "the link was closed", "agentUnreachable"));
        socket?.close(1001, "removed");
    }

    void connect();

    return {
        get state() {
            return state;
        },
        request,
        waitOnline,
        close,
    };
}

export function isLinkAbortError(error: unknown): boolean {
    return isAbortError(error);
}
