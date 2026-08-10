import type { DockerStat, ServiceInstance, StackDetail, StackSummary } from "./stack.ts";

/**
 * Bumped when a method is removed, when a method's parameters change incompatibly, or when an
 * event payload changes incompatibly. Adding a method, an optional parameter or an event does
 * not bump it.
 */
export const PROTOCOL_VERSION = 1;

/** Inbound frames larger than this close the connection with code 1009. */
export const MAX_FRAME_BYTES = 1024 * 1024;

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const AGENT_REQUEST_TIMEOUT_MS = 60_000;

/** Terminal writes are accumulated and flushed on this timer, per connection. */
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

/**
 * `ping` exists because a browser answers protocol-level pings inside the WebSocket
 * implementation, where page code cannot see them. A client that suspects its socket died while
 * the device was asleep sends this and treats silence as a dead socket.
 */
export type ClientMessage =
    | { t: "req"; id: number; endpoint: string; method: string; params?: unknown }
    | { t: "cancel"; id: number }
    | { t: "ping" };

export type ServerMessage =
    | { t: "res"; id: number; ok: true; data: unknown }
    | { t: "res"; id: number; ok: false; error: ProtocolError }
    | { t: "evt"; endpoint: string; event: string; data: unknown }
    | { t: "pong" };

export interface AgentSummary {
    /** "" for the local entry. */
    url: string;
    /** "" for the local entry. */
    endpoint: string;
    /** Never the password. */
    username: string;
    name: string;
}

export type AgentStatus = "connecting" | "online" | "offline";

export interface GeneralSettings {
    disableAuth: boolean;
    primaryHostname: string;
    checkUpdate: boolean;
    checkBeta: boolean;
    trustProxy: boolean;
    /** Run the upgrade as soon as the version check finds a newer release. */
    autoUpgrade: boolean;
}

export const GENERAL_SETTINGS_DEFAULTS: Readonly<GeneralSettings> = Object.freeze({
    disableAuth: false,
    primaryHostname: "",
    checkUpdate: true,
    checkBeta: false,
    trustProxy: false,
    autoUpgrade: false,
});

export const GENERAL_SETTINGS_GROUP = "general";

export interface MethodShape {
    params: unknown;
    result: unknown;
}

/**
 * The complete method namespace. Both sides import this, so a method added on one side without
 * the other fails to type check.
 */
export interface MethodMap {
    "auth.setup": { params: { username: string; password: string }; result: { ok: true } };
    "auth.login": {
        params: { username: string; password: string; totp?: string };
        result: { token: string; username: string } | { totpRequired: true };
    };
    "auth.loginByToken": { params: { token: string }; result: { username: string } };
    "auth.logout": { params: undefined; result: { ok: true } };
    "auth.changePassword": {
        params: { currentPassword: string; newPassword: string };
        result: { token: string };
    };
    "auth.disconnectOthers": { params: undefined; result: { ok: true } };
    "auth.totp.begin": { params: { currentPassword: string }; result: { secret: string; uri: string } };
    "auth.totp.enable": { params: { totp: string }; result: { ok: true } };
    "auth.totp.disable": { params: { currentPassword: string; totp: string }; result: { ok: true } };

    /**
     * `totpEnabled` is not a setting row; it is the acting user's second-factor state, added here
     * because the security screen has no other way to know it after a token resume. Additive, so
     * PROTOCOL_VERSION is unchanged.
     */
    "settings.get": {
        params: undefined;
        result: GeneralSettings & { globalENV: string; totpEnabled: boolean };
    };
    "settings.set": {
        params: {
            settings: Partial<GeneralSettings>;
            globalENV?: string;
            currentPassword?: string;
        };
        result: { ok: true };
    };

    "stack.list": { params: undefined; result: { stacks: Record<string, StackSummary> } };
    "stack.get": { params: { name: string }; result: { stack: StackDetail } };
    "stack.save": {
        params: { name: string; composeYAML: string; composeENV: string; isCreate: boolean };
        result: { ok: true };
    };
    "stack.deploy": {
        params: { name: string; composeYAML: string; composeENV: string; isCreate: boolean };
        result: { exitCode: number };
    };
    "stack.start": { params: { name: string }; result: { exitCode: number } };
    "stack.stop": { params: { name: string }; result: { exitCode: number } };
    "stack.restart": { params: { name: string }; result: { exitCode: number } };
    "stack.down": { params: { name: string }; result: { exitCode: number } };
    "stack.update": { params: { name: string }; result: { exitCode: number } };
    "stack.delete": { params: { name: string }; result: { exitCode: number } };
    "stack.serviceStatus": {
        params: { name: string };
        result: { services: Record<string, ServiceInstance[]> };
    };

    "service.start": { params: { stack: string; service: string }; result: { exitCode: number } };
    "service.stop": { params: { stack: string; service: string }; result: { exitCode: number } };
    "service.restart": { params: { stack: string; service: string }; result: { exitCode: number } };

    "docker.stats": { params: undefined; result: { stats: Record<string, DockerStat> } };
    "docker.networks": { params: undefined; result: { networks: string[] } };
    "docker.composerize": { params: { command: string }; result: { yaml: string } };

    "terminal.join": {
        params: { terminal: string };
        result: { buffer: string; exited: boolean; exitCode: number | null };
    };
    "terminal.leave": { params: { terminal: string }; result: { ok: true } };
    "terminal.input": { params: { terminal: string; data: string }; result: { ok: true } };
    "terminal.resize": {
        params: { terminal: string; cols: number; rows: number };
        result: { ok: true };
    };
    "terminal.exec": {
        params: { stack: string; service: string; shell: string };
        result: { terminal: string };
    };
    "terminal.main": { params: undefined; result: { terminal: string } };
    "terminal.mainEnabled": { params: undefined; result: { enabled: boolean } };

    /**
     * `reason` and `lastError` are translation keys, not sentences. `supported` false means the
     * deployment cannot be upgraded from inside, which is a statement about how it was started
     * rather than a failure.
     */
    "upgrade.status": {
        params: undefined;
        result: {
            supported: boolean;
            reason?: string;
            image?: string;
            running: boolean;
            terminal: string;
            lastError?: string;
        };
    };
    "upgrade.start": { params: undefined; result: { terminal: string } };

    /** Fetch the manifest now rather than waiting for the next scheduled check. */
    "version.check": { params: undefined; result: { latestVersion?: string } };

    "agent.list": { params: undefined; result: { agents: Record<string, AgentSummary> } };
    "agent.add": {
        params: { url: string; username: string; password: string; name?: string };
        result: { endpoint: string };
    };
    "agent.remove": { params: { url: string }; result: { ok: true } };
    "agent.rename": { params: { url: string; name: string }; result: { ok: true } };
}

export type MethodName = keyof MethodMap;
export type MethodParams<M extends MethodName> = MethodMap[M]["params"];
export type MethodResult<M extends MethodName> = MethodMap[M]["result"];

export interface MethodFlags {
    /** The connection must be authenticated. */
    auth: boolean;
    /** The method may carry a non-empty endpoint and be forwarded one hop. */
    route: boolean;
}

/**
 * The routing table from proposal 1, section 5-1. Registration asserts against it, so a
 * handler cannot silently disagree with the documented flags.
 */
export const METHOD_FLAGS: Readonly<Record<MethodName, MethodFlags>> = Object.freeze({
    "auth.setup": { auth: false, route: false },
    "auth.login": { auth: false, route: false },
    "auth.loginByToken": { auth: false, route: false },
    "auth.logout": { auth: true, route: false },
    "auth.changePassword": { auth: true, route: false },
    "auth.disconnectOthers": { auth: true, route: false },
    "auth.totp.begin": { auth: true, route: false },
    "auth.totp.enable": { auth: true, route: false },
    "auth.totp.disable": { auth: true, route: false },

    "settings.get": { auth: true, route: false },
    "settings.set": { auth: true, route: false },

    "stack.list": { auth: true, route: true },
    "stack.get": { auth: true, route: true },
    "stack.save": { auth: true, route: true },
    "stack.deploy": { auth: true, route: true },
    "stack.start": { auth: true, route: true },
    "stack.stop": { auth: true, route: true },
    "stack.restart": { auth: true, route: true },
    "stack.down": { auth: true, route: true },
    "stack.update": { auth: true, route: true },
    "stack.delete": { auth: true, route: true },
    "stack.serviceStatus": { auth: true, route: true },

    "service.start": { auth: true, route: true },
    "service.stop": { auth: true, route: true },
    "service.restart": { auth: true, route: true },

    "docker.stats": { auth: true, route: true },
    "docker.networks": { auth: true, route: true },
    "docker.composerize": { auth: true, route: false },

    "terminal.join": { auth: true, route: true },
    "terminal.leave": { auth: true, route: true },
    "terminal.input": { auth: true, route: true },
    "terminal.resize": { auth: true, route: true },
    "terminal.exec": { auth: true, route: true },
    "terminal.main": { auth: true, route: true },
    "terminal.mainEnabled": { auth: true, route: true },

    // Not routable: an upgrade acts on the process that receives it, and a remote agent updates
    // itself from its own UI.
    "upgrade.status": { auth: true, route: false },
    "upgrade.start": { auth: true, route: false },
    "version.check": { auth: true, route: false },

    "agent.list": { auth: true, route: false },
    "agent.add": { auth: true, route: false },
    "agent.remove": { auth: true, route: false },
    "agent.rename": { auth: true, route: false },
});

/**
 * Methods whose runtime is bounded by an image pull rather than by a deadline. The client
 * passes `timeout: 0` for these and relies on the terminal stream for progress.
 */
export const LONG_RUNNING_METHODS: ReadonlySet<string> = new Set<MethodName>([
    "stack.deploy",
    "stack.update",
    "stack.start",
    "stack.stop",
    "stack.restart",
    "stack.down",
    "stack.delete",
]);

export interface EventMap {
    info: {
        version: string;
        latestVersion?: string;
        protocolVersion: number;
        isContainer: boolean;
        primaryHostname: string;
    };
    setup: Record<string, never>;
    autoLogin: Record<string, never>;
    refresh: Record<string, never>;
    stackList: { stacks: Record<string, StackSummary> };
    agentList: { agents: Record<string, AgentSummary> };
    agentStatus: { endpoint: string; status: AgentStatus; message?: string };
    terminalWrite: { terminal: string; data: string };
    terminalExit: { terminal: string; exitCode: number };
}

export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = EventMap[E];

export function isProtocolError(value: unknown): value is ProtocolError {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { code?: unknown; message?: unknown };
    return (
        typeof candidate.message === "string" &&
        typeof candidate.code === "string" &&
        (ERROR_CODES as readonly string[]).includes(candidate.code)
    );
}
