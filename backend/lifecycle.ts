import { LOCAL_ENDPOINT, PROTOCOL_VERSION } from "../common/protocol.ts";
import * as pool from "./agent/pool.ts";
import { firstActiveUser, userCount } from "./auth/users.ts";
import type { Config } from "./config.ts";
import { log } from "./log.ts";
import * as settings from "./settings.ts";
import * as stackRegistry from "./stack/registry.ts";
import { detachConnection } from "./terminal/registry.ts";
import type { Conn } from "./ws/conn.ts";
import { authenticatedConnections, emitTo } from "./ws/hub.ts";
import { latestVersion, version } from "./version.ts";

let config: Readonly<Config> | null = null;

export function init(next: Readonly<Config>): void {
    config = next;
}

function requireConfig(): Readonly<Config> {
    if (config === null) throw new Error("lifecycle is not initialised");
    return config;
}

export function sendInfo(conn: Conn): void {
    const latest = latestVersion();
    emitTo(conn, "info", LOCAL_ENDPOINT, {
        version: version(),
        ...(latest === undefined ? {} : { latestVersion: latest }),
        protocolVersion: PROTOCOL_VERSION,
        isContainer: requireConfig().isContainer,
        primaryHostname: settings.generalSettings().primaryHostname,
    });
}

/** Re-send info to every authenticated connection, after a settings change. */
export function broadcastInfo(): void {
    for (const conn of authenticatedConnections()) sendInfo(conn);
}

/**
 * The single place where a connection begins receiving data, so nothing leaks to an anonymous
 * connection. It opens no link: the pool connects at startup and maintains its own links.
 */
export function afterLogin(conn: Conn): void {
    sendInfo(conn);
    emitTo(conn, "stackList", LOCAL_ENDPOINT, { stacks: stackRegistry.snapshot() });
    pool.primeConnection(conn);
}

/** Runs once per new socket: setup, autoLogin, or nothing but info. */
export function onConnectionOpen(conn: Conn): void {
    if (userCount() === 0) {
        emitTo(conn, "setup", LOCAL_ENDPOINT, {});
        sendInfo(conn);
        return;
    }

    // Read from the database on every connect rather than cached across the process, so the change
    // takes effect for the next connection without a restart.
    if (settings.generalSettings().disableAuth) {
        const user = firstActiveUser();
        if (user !== undefined) {
            // No session row is minted: there is no token to hand out, and one row per connection
            // would accumulate for the lifetime of the deployment.
            conn.userId = user.id;
            emitTo(conn, "autoLogin", LOCAL_ENDPOINT, {});
            afterLogin(conn);
            return;
        }
        log.warn("auth", "disableAuth is on but no active user exists");
    }

    sendInfo(conn);
}

export function onConnectionClose(conn: Conn): void {
    detachConnection(conn);
}
