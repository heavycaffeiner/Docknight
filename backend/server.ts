import type { Server } from "node:http";
import { registerAuthMethods } from "./auth/methods.ts";
import { startSessionSweep } from "./auth/session.ts";
import type { Config } from "./config.ts";
import { closeDatabase, openDatabase } from "./db/index.ts";
import { runMigrations } from "./db/migrate.ts";
import { prepareDirectories } from "./directories.ts";
import { createHttpServer } from "./http.ts";
import { initLifecycle, onConnOpened } from "./lifecycle.ts";
import { log } from "./log.ts";
import { startEviction } from "./rate-limit.ts";
import { startSettingsCacheSweeper } from "./settings.ts";
import type { Services } from "./services.ts";
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

    const ws = createWsLayer({ onConnOpened });
    const services: Services = { config, db, ws, shutdownHooks: [] };
    services.shutdownHooks.push(() => ws.closeAll(1001));

    initLifecycle(config, ws);
    registerAuthMethods();

    const stopSettingsSweep = startSettingsCacheSweeper();
    const stopRateLimitEviction = startEviction();
    const stopSessionSweep = startSessionSweep();

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
            stopSessionSweep();
            stopRateLimitEviction();

            // Hooks run in registration order: WS first, then terminals, then agent links, so
            // a child that triggers a write during teardown never hits a closed handle.
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
