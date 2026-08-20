/**
 * Bumped when a method is removed, when a method's parameters change incompatibly, or when an
 * event payload changes incompatibly. Adding a method, an optional parameter, or an event does
 * not bump it.
 */
export const PROTOCOL_VERSION = 1;

/** Inbound frames larger than this close the connection with code 1009. */
export const MAX_FRAME_BYTES = 1024 * 1024;

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const AGENT_REQUEST_TIMEOUT_MS = 60_000;

/** Terminal writes are accumulated and flushed on this timer, per connection and terminal. */
export const WRITE_COALESCE_MS = 16;

export const BACKPRESSURE_DROP_BYTES = 4 * 1024 * 1024;
export const BACKPRESSURE_RESUME_BYTES = 1024 * 1024;
export const BACKPRESSURE_CLOSE_BYTES = 16 * 1024 * 1024;

export const PING_INTERVAL_MS = 20_000;
export const PONG_TIMEOUT_MS = 60_000;

export const HEADER_ENDPOINT = "x-docknight-endpoint";
export const HEADER_PROTOCOL = "x-docknight-protocol";

/** Reserved endpoint label for the local host. Never stored as an agent row. */
export const LOCAL_ENDPOINT = "";
export const BROADCAST_ENDPOINT = "*";

export type ClientMessage =
    | { t: "req"; id: number; endpoint: string; method: string; params?: unknown }
    | { t: "cancel"; id: number }
    | { t: "ping" };

export type ServerMessage =
    | { t: "res"; id: number; ok: true; data: unknown }
    | { t: "res"; id: number; ok: false; error: ProtocolError }
    | { t: "evt"; endpoint: string; event: string; data: unknown }
    | { t: "pong" };

export const ERROR_CODES = [
    "unauthorized",
    "unknownMethod",
    "invalidParams",
    "duplicateRequestId",
    "notRoutable",
    "notFound",
    "conflict",
    "validation",
    "commandFailed",
    "agentUnreachable",
    "agentTimeout",
    "timeout",
    "disconnected",
    "rateLimited",
    "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ProtocolError {
    code: ErrorCode;
    /** English, for logs and as a fallback. */
    message: string;
    /** Translation key the UI prefers when present. */
    i18n?: string;
    values?: Record<string, string | number>;
}

export function isProtocolError(value: unknown): value is ProtocolError {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { code?: unknown; message?: unknown };
    return (
        typeof candidate.message === "string" &&
        typeof candidate.code === "string" &&
        (ERROR_CODES as readonly string[]).includes(candidate.code)
    );
}

/**
 * The method namespace. Empty here; every feature module augments this interface via
 * declaration merging (`declare module "../../common/protocol.ts"`) as it registers its own
 * methods, so a method added on one side without the other fails to type check.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by declaration merging
export interface MethodMap {}

/** The event namespace, augmented the same way as MethodMap. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by declaration merging
export interface EventMap {}

export type MethodName = keyof MethodMap;
export type MethodParams<M extends MethodName> = MethodMap[M] extends { params: infer P }
    ? P
    : never;
export type MethodResult<M extends MethodName> = MethodMap[M] extends { result: infer R }
    ? R
    : never;

export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = EventMap[E];
