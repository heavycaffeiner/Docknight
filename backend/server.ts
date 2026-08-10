import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import * as agentCrypto from "./agent/crypto.ts";
import { registerAgentMethods } from "./agent/methods.ts";
import * as pool from "./agent/pool.ts";
import { registerAuthMethods } from "./auth/methods.ts";
import * as sessions from "./auth/session.ts";
import { userCount } from "./auth/users.ts";
import { registerComposerizeMethod } from "./composerize.ts";
import type { Config } from "./config.ts";
import { closeDatabase, openDatabase } from "./db/index.ts";
import { runMigrations } from "./db/migrate.ts";
import { prepareDirectories } from "./directories.ts";
import { createServer } from "./http.ts";
import * as lifecycle from "./lifecycle.ts";
import { log } from "./log.ts";
import * as rateLimit from "./rate-limit.ts";
import * as settings from "./settings.ts";
import { registerStackMethods } from "./stack/methods.ts";
import * as stackRegistry from "./stack/registry.ts";
import { registerTerminalMethods } from "./terminal/methods.ts";
import * as terminals from "./terminal/registry.ts";
import { closeAllConnections } from "./ws/hub.ts";
import { setBroadcaster, setForwarder } from "./ws/router.ts";
import { attachWebSocketServer, type WsServer } from "./ws/server.ts";
import { loadVersion, startVersionCheck, stopVersionCheck } from "./version.ts";

const SHUTDOWN_HARD_LIMIT_MS = 30_000;

export interface RunningServer {
    /** Idempotent ordered shutdown. Resolves once every resource is released. */
    stop(signal: string): Promise<void>;
    port: number;
}

/** Wire configuration, database, services and HTTP together, and begin listening. */
export async function start(config: Readonly<Config>): Promise<RunningServer> {
    await prepareDirectories(config);

    const db = openDatabase(config);
    runMigrations(db);

    const version = await loadVersion(fileURLToPath(new URL("../package.json", import.meta.url)));
    log.info("server", `Docknight ${version} starting`);

    settings.startCacheSweeper();
    rateLimit.startEviction();
    sessions.startSweeper();

    agentCrypto.init(config);
    stackRegistry.init(config);
    lifecycle.init(config);

    registerAuthMethods(config);
    registerStackMethods(config);
    registerTerminalMethods(config);
    registerAgentMethods(config);
    registerComposerizeMethod();

    setForwarder(pool.request);
    setBroadcaster(pool.broadcast);

    if (userCount() === 0) log.info("server", "no administrator yet; the UI will show setup");

    // The pool connects at startup, before the listener, and maintains its own links.
    pool.connectAll();

    const httpServer: Server = await createServer(config);
    const wsServer: WsServer = attachWebSocketServer(httpServer, {
        onOpen: lifecycle.onConnectionOpen,
        onClose: lifecycle.onConnectionClose,
    });

    await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException): void => {
            reject(error);
        };
        httpServer.once("error", onError);
        httpServer.listen(config.port, config.hostname, () => {
            httpServer.off("error", onError);
            resolve();
        });
    });
    log.info("server", `listening on ${config.hostname ?? "0.0.0.0"}:${config.port}`);

    stackRegistry.startRefreshTimer();
    terminals.startIdleSweeper();
    startVersionCheck();

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
            wsServer.close();
            stackRegistry.stopRefreshTimer();
            stopVersionCheck();
            sessions.stopSweeper();
            rateLimit.stopEviction();

            closeAllConnections(1001, "server shutting down");
            // Children are terminated before the database closes, so a child that triggers a write
            // during teardown cannot hit a closed handle.
            await terminals.closeAll();
            pool.closeAll();

            settings.stopCacheSweeper();
            closeDatabase();
            clearTimeout(hard);
            log.info("server", "shutdown complete");
        })();
        return stopping;
    };

    return { stop, port: config.port };
}
