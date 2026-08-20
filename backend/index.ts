import { ConfigError, loadConfig } from "./config.ts";
import { DataDirError } from "./directories.ts";
import { MigrationError } from "./db/migrate.ts";
import { initLogging, log } from "./log.ts";
import { start } from "./server.ts";

function fatal(message: string): never {
    process.stderr.write(`docknight: ${message}\n`);
    process.exit(1);
}

async function main(): Promise<void> {
    let config;
    try {
        config = loadConfig(process.argv, process.env);
    } catch (error) {
        if (error instanceof ConfigError) fatal(error.message);
        throw error;
    }

    initLogging(config.logLevel);

    let server;
    try {
        server = await start(config);
    } catch (error) {
        if (error instanceof DataDirError || error instanceof MigrationError) fatal(error.message);
        if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
            fatal(`port ${config.port} is already in use`);
        }
        log.error("server", "startup failed", error);
        process.exit(1);
    }

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.on(signal, () => {
            void server.stop(signal).then(() => process.exit(0));
        });
    }
}

// A single failed compose command must not take down a manager other stacks depend on.
process.on("unhandledRejection", (reason) => {
    log.error("process", "unhandled rejection", reason);
});
process.on("uncaughtException", (error) => {
    log.error("process", "uncaught exception", error);
});

void main();
