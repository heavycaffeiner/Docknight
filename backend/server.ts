import type { Server } from "node:http";
import { registerAgentMethods } from "./agent/methods.ts";
import { createAgentPool } from "./agent/pool.ts";
import { agentStore } from "./agent/store.ts";
import { loadOrCreateKey } from "./agent/crypto.ts";
import { registerAuthMethods } from "./auth/methods.ts";
import { startSessionSweep } from "./auth/session.ts";
import type { Config } from "./config.ts";
import { closeDatabase, openDatabase } from "./db/index.ts";
import { runMigrations } from "./db/migrate.ts";
import { prepareDirectories } from "./directories.ts";
import { createHttpServer } from "./http.ts";
import { broadcastInfo, initLifecycle, onConnOpened } from "./lifecycle.ts";
import { log } from "./log.ts";
import { startEviction } from "./rate-limit.ts";
import { startSettingsCacheSweeper } from "./settings.ts";
import type { Services } from "./services.ts";
import { registerStackMethods, stackResolverFor } from "./stack/methods.ts";
import { createStackRegistry } from "./stack/registry.ts";
import { registerTerminalMethods } from "./terminal/methods.ts";
import { createTerminalRegistry, type TerminalRegistry } from "./terminal/registry.ts";
import { registerUpgradeMethods } from "./upgrade-methods.ts";
import { startUpgrade, upgradeIsRunning } from "./upgrade.ts";
import { startVersionCheck } from "./version.ts";
import { setBroadcaster, setForwarder } from "./ws/router.ts";
import { createWsLayer } from "./ws/server.ts";

const SHUTDOWN_HARD_LIMIT_MS = 30_000;

export interface RunningServer {
    /** Idempotent ordered shutdown. Resolves once every resource is released. */
    stop(signal: string): Promise<void>;
    port: number;
}

function listen(server: Server, port: number, hostname: string | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException): void => {
            server.off("listening", onListening);
            reject(error);
        };
        const onListening = (): void => {
            server.off("error", onError);
            resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, hostname);
    });
}

/** Wire configuration, database, services and HTTP together, and begin listening. */
export async function start(config: Readonly<Config>): Promise<RunningServer> {
    await prepareDirectories(config);

    const db = openDatabase(config);
    runMigrations(db);

    // The WsLayer needs the terminal registry to detach a closing connection, and the registry
    // needs the WsLayer to fan out output; the mutable ref breaks the cycle without exposing
    // either half before it exists.
    let terminals: TerminalRegistry | null = null;
    const ws = createWsLayer({
        onConnOpened,
        onConnClosed: (conn) => terminals?.detachConnection(conn),
    });
    terminals = createTerminalRegistry(ws);
    const stacks = createStackRegistry(ws, config);
    const agentKey = await loadOrCreateKey(config.dataDir);
    const agents = createAgentPool(ws, agentKey);
    setForwarder((endpoint, method, params, signal, conn) => agents.request(endpoint, method, params, signal, conn));
    setBroadcaster((method, params) => agents.broadcast(method, params));

    const services: Services = { config, db, ws, terminals, stacks, shutdownHooks: [] };
    services.shutdownHooks.push(() => ws.closeAll(1001));
    // Terminals close after WS (no new write can start once sockets are gone), agent links
    // close last, before the database: phase 1's FIFO shutdown hook ordering.
    services.shutdownHooks.push(() => services.terminals.closeAll());
    services.shutdownHooks.push(() => agents.closeAll());

    initLifecycle(config, ws, stacks);
    registerAuthMethods(config);
    registerStackMethods(stacks, terminals, config);
    registerTerminalMethods(terminals, config, stackResolverFor(stacks, config));
    registerAgentMethods(agents, ws, config, agentKey);
    registerUpgradeMethods(config, terminals);

    const stopSettingsSweep = startSettingsCacheSweeper();
    const stopRateLimitEviction = startEviction();
    const stopSessionSweep = startSessionSweep();
    const stopStackRefresh = stacks.startRefreshTimer();
    const stopVersionCheck = startVersionCheck(config, {
        onLatestVersionChanged: broadcastInfo,
        onAutoUpgrade: (cfg) => {
            if (upgradeIsRunning()) return;
            // No connection to stream the pull to: this path never has a browser attached, by
            // definition, since it runs from the version check's own 48-hour timer.
            void startUpgrade(cfg, null, terminals as TerminalRegistry).catch((error: unknown) => {
                log.warn("upgrade", "auto-upgrade failed to start", error);
            });
        },
    });

    // Begin maintaining a link to every configured host, regardless of whether a browser is
    // connected, so the manager's view is warm when the first one arrives.
    for (const row of agentStore.list()) {
        if (row.active === 1) agents.connect(row);
    }

    const httpServer = createHttpServer(config, ws.upgradeHandler);
    await listen(httpServer, config.port, config.hostname);
    log.info("server", `listening on ${config.hostname ?? "0.0.0.0"}:${config.port}`);

    let stopping: Promise<void> | null = null;

    const stop = (signal: string): Promise<void> => {
        if (stopping !== null) return stopping;
        stopping = (async () => {
            log.info("server", `shutdown requested by ${signal}`);

            const hard = setTimeout(() => {
                log.error("server", "shutdown did not finish in time, exiting hard");
                process.exit(1);
            }, SHUTDOWN_HARD_LIMIT_MS);
            hard.unref();

            httpServer.close();
            stopStackRefresh();
            stopVersionCheck();
            stopSessionSweep();
            stopRateLimitEviction();

            // Hooks run in registration order: WS, then terminals, then agent links, so a
            // child that triggers a write during teardown never hits a closed handle.
            for (const hook of services.shutdownHooks) {
                await hook();
            }

            stopSettingsSweep();
            closeDatabase();
            clearTimeout(hard);
            log.info("server", "shutdown complete");
        })();
        return stopping;
    };

    return { stop, port: config.port };
}
