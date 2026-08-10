import { parseArgs } from "node:util";
import { resolve, sep } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Config {
    port: number;
    hostname: string | undefined;
    dataDir: string;
    stacksDir: string;
    enableConsole: boolean;
    sslKey: string | undefined;
    sslCert: string | undefined;
    sslKeyPassphrase: string | undefined;
    logLevel: LogLevel;
    puid: number | undefined;
    pgid: number | undefined;
    isContainer: boolean;
}

export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigError";
    }
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const OPTIONS = {
    port: { type: "string" },
    hostname: { type: "string" },
    "data-dir": { type: "string" },
    "stacks-dir": { type: "string" },
    "enable-console": { type: "boolean" },
    "ssl-key": { type: "string" },
    "ssl-cert": { type: "string" },
    "ssl-key-passphrase": { type: "string" },
    "log-level": { type: "string" },
} as const;

function firstDefined(...values: (string | undefined)[]): string | undefined {
    for (const value of values) {
        if (value !== undefined && value !== "") return value;
    }
    return undefined;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
    if (raw === undefined) return fallback;
    const value = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off", ""].includes(value)) return false;
    throw new ConfigError(`enableConsole: cannot read ${JSON.stringify(raw)} as a boolean`);
}

function parseUid(raw: string | undefined, key: string): number | undefined {
    if (raw === undefined || raw === "") return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
        throw new ConfigError(`${key}: ${JSON.stringify(raw)} is not a non-negative integer`);
    }
    return value;
}

function isWithin(parent: string, child: string): boolean {
    return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Parse process arguments and environment into a validated, frozen configuration.
 * Precedence per key: CLI argument, then environment variable, then default.
 *
 * @throws ConfigError when a value fails to parse or a cross-field rule is violated. The
 *         message names the offending key and the value that was rejected.
 */
export function loadConfig(argv: string[], env: NodeJS.ProcessEnv): Readonly<Config> {
    let values: Partial<Record<keyof typeof OPTIONS, string | boolean>>;
    try {
        ({ values } = parseArgs({
            args: argv.slice(2),
            options: OPTIONS,
            allowPositionals: false,
            strict: true,
        }) as { values: Partial<Record<keyof typeof OPTIONS, string | boolean>> });
    } catch (error) {
        throw new ConfigError(error instanceof Error ? error.message : String(error));
    }

    const portRaw = firstDefined(values.port as string | undefined, env.DOCKNIGHT_PORT) ?? "5001";
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ConfigError(`port: ${JSON.stringify(portRaw)} is not an integer in 1 to 65535`);
    }

    const hostname = firstDefined(values.hostname as string | undefined, env.DOCKNIGHT_HOSTNAME);

    const dataDir = resolve(
        firstDefined(values["data-dir"] as string | undefined, env.DOCKNIGHT_DATA_DIR) ?? "/app/data",
    );
    const stacksDir = resolve(
        firstDefined(values["stacks-dir"] as string | undefined, env.DOCKNIGHT_STACKS_DIR) ??
            "/opt/stacks",
    );

    if (isWithin(dataDir, stacksDir) || isWithin(stacksDir, dataDir)) {
        throw new ConfigError(
            `dataDir and stacksDir must not overlap: ${dataDir} and ${stacksDir}. ` +
                "The database file would otherwise be treated as a stack candidate on every scan.",
        );
    }

    const enableConsole =
        values["enable-console"] === true
            ? true
            : parseBoolean(env.DOCKNIGHT_ENABLE_CONSOLE, false);

    const sslKey = firstDefined(values["ssl-key"] as string | undefined, env.DOCKNIGHT_SSL_KEY);
    const sslCert = firstDefined(values["ssl-cert"] as string | undefined, env.DOCKNIGHT_SSL_CERT);
    if ((sslKey === undefined) !== (sslCert === undefined)) {
        throw new ConfigError("sslKey and sslCert: set both or neither");
    }
    const sslKeyPassphrase = firstDefined(
        values["ssl-key-passphrase"] as string | undefined,
        env.DOCKNIGHT_SSL_KEY_PASSPHRASE,
    );

    const logLevelRaw =
        firstDefined(values["log-level"] as string | undefined, env.DOCKNIGHT_LOG_LEVEL) ?? "info";
    if (!LOG_LEVELS.includes(logLevelRaw as LogLevel)) {
        throw new ConfigError(
            `logLevel: ${JSON.stringify(logLevelRaw)} is not one of ${LOG_LEVELS.join(", ")}`,
        );
    }

    const puid = parseUid(env.PUID, "PUID");
    const pgid = parseUid(env.PGID, "PGID");
    if ((puid === undefined) !== (pgid === undefined)) {
        throw new ConfigError("PUID and PGID: set both or neither");
    }

    return Object.freeze({
        port,
        hostname,
        dataDir,
        stacksDir,
        enableConsole,
        sslKey,
        sslCert,
        sslKeyPassphrase,
        logLevel: logLevelRaw as LogLevel,
        puid,
        pgid,
        isContainer: env.DOCKNIGHT_IS_CONTAINER === "1",
    });
}
