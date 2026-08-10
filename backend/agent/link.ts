import { WebSocket } from "ws";
import { RequestError, isAbortError, unauthorized } from "../../common/errors.ts";
import {
    AGENT_REQUEST_TIMEOUT_MS,
    HEADER_ENDPOINT,
    HEADER_PROTOCOL,
    LOCAL_ENDPOINT,
    LONG_RUNNING_METHODS,
    MAX_FRAME_BYTES,
    PROTOCOL_VERSION,
    isProtocolError,
    type AgentStatus,
    type ProtocolError,
    type ServerMessage,
} from "../../common/protocol.ts";
import { log } from "../log.ts";
import { WS_PATH } from "../ws/server.ts";

export type LinkState = "connecting" | "authenticating" | "online" | "backoff" | "failed" | "closed";

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
const BACKOFF_JITTER_MS = 1_000;
const LOGIN_TIMEOUT_MS = 15_000;
/** A request issued during a page load can arrive before the link finishes authenticating. */
const ONLINE_WAIT_MS = 10_000;

export interface LinkHooks {
    onStatus: (endpoint: string, status: AgentStatus, message?: string) => void;
    onEvent: (endpoint: string, event: string, data: unknown) => void;
    onOnline: (link: Link) => void;
}

interface Pending {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    timer: NodeJS.Timeout | null;
}

export interface LinkOptions {
    url: string;
    endpoint: string;
    username: string;
    /** Resolved lazily, so a decryption failure surfaces as a link status rather than at startup. */
    password: () => string;
    hooks: LinkHooks;
}

export class Link {
    readonly url: string;
    readonly endpoint: string;
    readonly username: string;

    #password: () => string;
    #hooks: LinkHooks;
    #socket: WebSocket | null = null;
    #state: LinkState = "closed";
    #nextId = 1;
    #pending = new Map<number, Pending>();
    #attempt = 0;
    #retry: NodeJS.Timeout | null = null;
    #onlineWaiters: (() => void)[] = [];
    #stopped = false;

    constructor(options: LinkOptions) {
        this.url = options.url;
        this.endpoint = options.endpoint;
        this.username = options.username;
        this.#password = options.password;
        this.#hooks = options.hooks;
    }

    get state(): LinkState {
        return this.#state;
    }

    #setState(state: LinkState): void {
        this.#state = state;
        if (state === "online") {
            const waiters = this.#onlineWaiters;
            this.#onlineWaiters = [];
            for (const resolve of waiters) resolve();
        }
    }

    connect(): void {
        if (this.#stopped) return;
        if (this.#state === "connecting" || this.#state === "authenticating" || this.#state === "online") {
            return;
        }

        this.#setState("connecting");
        this.#hooks.onStatus(this.endpoint, "connecting");

        const target = this.url.replace(/\/+$/, "") + WS_PATH;
        let socket: WebSocket;
        try {
            socket = new WebSocket(target, {
                headers: {
                    [HEADER_ENDPOINT]: this.endpoint,
                    [HEADER_PROTOCOL]: String(PROTOCOL_VERSION),
                },
                maxPayload: MAX_FRAME_BYTES,
                handshakeTimeout: 10_000,
            });
        } catch (error) {
            this.#fail("connection refused", error, false);
            return;
        }
        this.#socket = socket;

        socket.on("unexpected-response", (_request, response) => {
            // The remote host rejects a protocol mismatch during upgrade, and it will keep saying
            // no until its configuration changes, so this link stops retrying.
            const reason =
                response.statusCode === 400
                    ? "unsupported protocol version"
                    : `handshake rejected with ${String(response.statusCode)}`;
            this.#fail(reason, null, reason === "unsupported protocol version");
        });

        socket.on("open", () => {
            this.#setState("authenticating");
            void this.#login();
        });

        socket.on("message", (raw: Buffer) => this.#onMessage(raw.toString("utf8")));

        socket.on("close", () => {
            const wasOnline = this.#state === "online";
            this.#rejectAll(
                new RequestError("agentUnreachable", `link to ${this.endpoint} closed`, {
                    i18n: "agentUnreachable",
                }),
            );
            this.#socket = null;
            if (this.#stopped || this.#state === "failed") return;
            this.#hooks.onStatus(this.endpoint, "offline", wasOnline ? undefined : "connection refused");
            this.#scheduleRetry();
        });

        socket.on("error", (error: Error) => {
            log.debug("agent", `${this.endpoint} socket error: ${error.message}`);
        });
    }

    async #login(): Promise<void> {
        let password: string;
        try {
            password = this.#password();
        } catch (error) {
            this.#fail("stored credential cannot be decrypted", error, true);
            return;
        }

        try {
            await this.request(
                "auth.login",
                { username: this.username, password },
                undefined,
                LOGIN_TIMEOUT_MS,
            );
        } catch (error) {
            const rejected = isProtocolError(error) && error.code === "unauthorized";
            // A wrong password will not fix itself, so the link stops retrying and reports why.
            this.#fail(rejected ? "authentication failed" : "login failed", error, rejected);
            return;
        }

        this.#attempt = 0;
        this.#setState("online");
        this.#hooks.onStatus(this.endpoint, "online");
        log.info("agent", `${this.endpoint} online`);
        this.#hooks.onOnline(this);
    }

    #onMessage(text: string): void {
        let message: ServerMessage;
        try {
            const parsed: unknown = JSON.parse(text);
            if (typeof parsed !== "object" || parsed === null) return;
            message = parsed as ServerMessage;
        } catch (error) {
            log.warn("agent", `${this.endpoint} sent an unusable frame`, error);
            return;
        }

        if (message.t === "evt") {
            this.#hooks.onEvent(this.endpoint, message.event, message.data);
            return;
        }
        if (message.t !== "res") return;

        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        if (pending.timer !== null) clearTimeout(pending.timer);

        if (message.ok) pending.resolve(message.data);
        // Errors are forwarded verbatim, code and i18n key included, so the browser cannot tell
        // whether a stack lives locally or remotely from the error alone.
        else pending.reject(toRequestError(message.error));
    }

    /** Send one request over this link and resolve with its result. */
    request(
        method: string,
        params: unknown,
        signal?: AbortSignal,
        timeoutMs?: number,
    ): Promise<unknown> {
        const socket = this.#socket;
        if (socket === null || socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(
                new RequestError("agentUnreachable", `no open link to ${this.endpoint}`, {
                    i18n: "agentUnreachable",
                }),
            );
        }

        const id = this.#nextId++;
        const deadline =
            timeoutMs !== undefined
                ? timeoutMs
                : LONG_RUNNING_METHODS.has(method)
                  ? 0
                  : AGENT_REQUEST_TIMEOUT_MS;

        return new Promise<unknown>((resolve, reject) => {
            const timer =
                deadline > 0
                    ? setTimeout(() => {
                          this.#pending.delete(id);
                          reject(
                              new RequestError(
                                  "agentTimeout",
                                  `${this.endpoint} did not answer ${method} within ${deadline} ms`,
                                  { i18n: "agentTimeout" },
                              ),
                          );
                      }, deadline)
                    : null;
            timer?.unref();

            this.#pending.set(id, { resolve, reject, timer });

            const onAbort = (): void => {
                const pending = this.#pending.get(id);
                if (pending === undefined) return;
                this.#pending.delete(id);
                if (pending.timer !== null) clearTimeout(pending.timer);
                try {
                    socket.send(JSON.stringify({ t: "cancel", id }));
                } catch {
                    // The socket is gone; nothing to cancel remotely.
                }
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            };
            signal?.addEventListener("abort", onAbort, { once: true });

            // From the receiving host's point of view the work is local.
            socket.send(
                JSON.stringify({ t: "req", id, endpoint: LOCAL_ENDPOINT, method, params }),
                (error) => {
                    if (error === undefined || error === null) return;
                    this.#pending.delete(id);
                    if (timer !== null) clearTimeout(timer);
                    reject(
                        new RequestError("agentUnreachable", `send to ${this.endpoint} failed`, {
                            i18n: "agentUnreachable",
                            cause: error,
                        }),
                    );
                },
            );
        });
    }

    /** Wait for the link to come online, then fail fast. */
    async waitOnline(): Promise<void> {
        if (this.#state === "online") return;
        if (this.#state === "failed" || this.#stopped) {
            throw new RequestError("agentUnreachable", `${this.endpoint} is not connected`, {
                i18n: "agentUnreachable",
            });
        }
        const online = await Promise.race([
            new Promise<boolean>((resolve) => this.#onlineWaiters.push(() => resolve(true))),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ONLINE_WAIT_MS).unref()),
        ]);
        if (!online) {
            throw new RequestError("agentUnreachable", `${this.endpoint} did not come online`, {
                i18n: "agentUnreachable",
            });
        }
    }

    #fail(message: string, error: unknown, terminal: boolean): void {
        if (error !== null && error !== undefined && !isAbortError(error)) {
            log.warn("agent", `${this.endpoint}: ${message}`, error);
        } else {
            log.warn("agent", `${this.endpoint}: ${message}`);
        }
        this.#rejectAll(
            new RequestError("agentUnreachable", `${this.endpoint}: ${message}`, {
                i18n: "agentUnreachable",
            }),
        );
        this.#hooks.onStatus(this.endpoint, "offline", message);
        try {
            this.#socket?.close(1000, "link failed");
        } catch {
            // Already gone.
        }
        this.#socket = null;
        this.#setState(terminal ? "failed" : "backoff");
        if (!terminal) this.#scheduleRetry();
    }

    #scheduleRetry(): void {
        if (this.#stopped || this.#retry !== null) return;
        this.#setState("backoff");
        this.#attempt += 1;
        const delay =
            Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (this.#attempt - 1)) +
            Math.floor(Math.random() * BACKOFF_JITTER_MS);
        this.#retry = setTimeout(() => {
            this.#retry = null;
            this.connect();
        }, delay);
        this.#retry.unref();
        log.debug("agent", `${this.endpoint} retrying in ${delay} ms`);
    }

    #rejectAll(error: unknown): void {
        const pending = [...this.#pending.values()];
        this.#pending.clear();
        for (const entry of pending) {
            if (entry.timer !== null) clearTimeout(entry.timer);
            entry.reject(error);
        }
    }

    close(code = 1001): void {
        this.#stopped = true;
        if (this.#retry !== null) clearTimeout(this.#retry);
        this.#retry = null;
        this.#rejectAll(
            new RequestError("agentUnreachable", `link to ${this.endpoint} closed`, {
                i18n: "agentUnreachable",
            }),
        );
        this.#setState("closed");
        try {
            this.#socket?.close(code, "shutting down");
        } catch {
            // Already gone.
        }
        this.#socket = null;
    }
}

function toRequestError(error: ProtocolError): RequestError {
    return new RequestError(error.code, error.message, {
        i18n: error.i18n,
        values: error.values,
    });
}

/**
 * Open a link, log in, and close it. This is what turns a typo in the URL or the password into an
 * error on the add form rather than a host row that is permanently offline.
 */
export function testConnection(url: string, username: string, password: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const target = url.replace(/\/+$/, "") + WS_PATH;
        let socket: WebSocket;
        try {
            socket = new WebSocket(target, {
                headers: {
                    [HEADER_ENDPOINT]: new URL(url).host,
                    [HEADER_PROTOCOL]: String(PROTOCOL_VERSION),
                },
                handshakeTimeout: 10_000,
                maxPayload: MAX_FRAME_BYTES,
            });
        } catch (error) {
            reject(
                new RequestError("agentUnreachable", "connection refused", {
                    i18n: "agentUnreachable",
                    cause: error,
                }),
            );
            return;
        }

        let settled = false;
        const finish = (error: unknown): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                socket.close(1000, "credential test complete");
            } catch {
                // Already gone.
            }
            if (error === null) resolve();
            else reject(error);
        };

        const timer = setTimeout(
            () =>
                finish(
                    new RequestError("agentUnreachable", "the host did not answer", {
                        i18n: "agentUnreachable",
                    }),
                ),
            LOGIN_TIMEOUT_MS,
        );
        timer.unref();

        socket.on("unexpected-response", (_request, response) => {
            finish(
                new RequestError(
                    "agentUnreachable",
                    response.statusCode === 400
                        ? "unsupported protocol version"
                        : `handshake rejected with ${String(response.statusCode)}`,
                    { i18n: "agentUnreachable" },
                ),
            );
        });
        socket.on("error", (error: Error) =>
            finish(
                new RequestError("agentUnreachable", "connection refused", {
                    i18n: "agentUnreachable",
                    cause: error,
                }),
            ),
        );
        socket.on("open", () => {
            socket.send(
                JSON.stringify({
                    t: "req",
                    id: 1,
                    endpoint: LOCAL_ENDPOINT,
                    method: "auth.login",
                    params: { username, password },
                }),
            );
        });
        socket.on("message", (raw: Buffer) => {
            let message: ServerMessage;
            try {
                message = JSON.parse(raw.toString("utf8")) as ServerMessage;
            } catch {
                return;
            }
            if (message.t !== "res" || message.id !== 1) return;
            if (message.ok) {
                const data = message.data as { totpRequired?: boolean } | null;
                if (data?.totpRequired === true) {
                    finish(
                        unauthorized("that host requires a second factor, which a link cannot supply", {
                            i18n: "agentAuthFailed",
                        }),
                    );
                    return;
                }
                finish(null);
                return;
            }
            finish(
                new RequestError(message.error.code, message.error.message, {
                    i18n: message.error.code === "unauthorized" ? "agentAuthFailed" : message.error.i18n,
                }),
            );
        });
        socket.on("close", () =>
            finish(
                new RequestError("agentUnreachable", "the host closed the connection", {
                    i18n: "agentUnreachable",
                }),
            ),
        );
    });
}
