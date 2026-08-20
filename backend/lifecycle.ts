import { PROTOCOL_VERSION } from "../common/protocol.ts";
import type { Config } from "./config.ts";
import { one } from "./db/index.ts";
import { Settings } from "./settings.ts";
import type { StackRegistry } from "./stack/registry.ts";
import { getLatestVersion, VERSION } from "./version.ts";
import type { Conn } from "./ws/conn.ts";
import type { WsLayer } from "./ws/server.ts";

declare module "../common/protocol.ts" {
    interface EventMap {
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
        stackList: { stacks: Record<string, unknown> };
        /** Stubbed to an empty map until proposal 5 (phase 6) supplies the agent store. */
        agentList: { agents: Record<string, unknown> };
    }
}

interface UserCountRow {
    count: number;
}
interface AdminRow {
    id: number;
}

let config: Readonly<Config> | null = null;
let ws: WsLayer | null = null;
let stacks: StackRegistry | null = null;

/** Called once at startup so the hooks below can reach configuration, WS, and stack discovery. */
export function initLifecycle(
    nextConfig: Readonly<Config>,
    nextWs: WsLayer,
    nextStacks: StackRegistry,
): void {
    config = nextConfig;
    ws = nextWs;
    stacks = nextStacks;
}

function requireConfig(): Readonly<Config> {
    if (config === null) throw new Error("lifecycle is not initialised");
    return config;
}

function requireWs(): WsLayer {
    if (ws === null) throw new Error("lifecycle is not initialised");
    return ws;
}

function requireStacks(): StackRegistry {
    if (stacks === null) throw new Error("lifecycle is not initialised");
    return stacks;
}

function buildInfo(): {
    version: string;
    latestVersion?: string;
    protocolVersion: number;
    isContainer: boolean;
    primaryHostname: string;
} {
    const latest = getLatestVersion();
    return {
        version: VERSION,
        ...(latest === undefined ? {} : { latestVersion: latest }),
        protocolVersion: PROTOCOL_VERSION,
        isContainer: requireConfig().isContainer,
        primaryHostname: (Settings.get("primaryHostname") as string | undefined) ?? "",
    };
}

/** Re-send info to every authenticated connection, after a settings change. */
export function broadcastInfo(): void {
    const layer = requireWs();
    layer.broadcastEvent((conn) => conn.userId !== null, "", "info", buildInfo());
}

/**
 * The single place where a connection begins receiving data, so nothing leaks to an anonymous
 * connection. The agent snapshot is an empty stub until proposal 5 (phase 6) lands; the event
 * shape is final so that phase only changes what populates it.
 */
export function afterLogin(conn: Conn): void {
    const layer = requireWs();
    layer.sendEvent(conn, "", "info", buildInfo());
    layer.sendEvent(conn, "", "stackList", { stacks: requireStacks().snapshot() });
    layer.sendEvent(conn, "", "agentList", { agents: {} });
}

/**
 * Close every other authenticated connection belonging to the same user, after telling each
 * one to reload. Used by `auth.disconnectOthers`; stored session rows are untouched, matching
 * `auth.logout`'s narrower, single-session revocation.
 */
export function disconnectOtherConnections(conn: Conn): void {
    const layer = requireWs();
    for (const other of layer.conns) {
        if (other === conn || other.userId !== conn.userId) continue;
        layer.sendEvent(other, "", "refresh", {});
        other.socket.close(1000, "signed out from another session");
    }
}

/** Runs once per new socket: setup, autoLogin, or nothing but info. */
export function onConnOpened(conn: Conn): void {
    const layer = requireWs();
    layer.sendEvent(conn, "", "info", buildInfo());

    const userCount = one<UserCountRow>("SELECT count(*) as count FROM user")?.count ?? 0;
    if (userCount === 0) {
        layer.sendEvent(conn, "", "setup", {});
        return;
    }

    // Read from the database on every connect rather than cached across the process, so
    // toggling disableAuth takes effect for the next connection without a restart.
    if (Settings.get("disableAuth") === true) {
        const admin = one<AdminRow>("SELECT id FROM user WHERE active = 1 ORDER BY id LIMIT 1");
        if (admin !== undefined) {
            // No session row is minted: there is no token to hand out, and one row per
            // connection would accumulate for the lifetime of the deployment.
            conn.userId = admin.id;
            layer.sendEvent(conn, "", "autoLogin", {});
            afterLogin(conn);
        }
    }
}
