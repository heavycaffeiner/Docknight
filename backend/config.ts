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
    versionManifestUrl: string;
}

export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigError";
    }
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const DEFAULT_VERSION_MANIFEST_URL =
    "https://raw.githubusercontent.com/heavycaffeiner/docknight/main/version.json";

const OPTIONS = {
    port: { type: "string" },
    hostname: { type: "string" },
    "data-dir": { type: "string" },
    "stacks-dir": { type: "string" },
    "enable-console": { type: "string" },
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

function parseBool(raw: string | undefined, fallback: boolean): boolean {
    if (raw === undefined) return fallback;
    return raw === "true" || raw === "1";
}

function parseUid(raw: string | undefined, key: string): number | undefined {
    if (raw === undefined || raw === "") return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
        throw new ConfigError(`${key}: expected a non-negative integer, got ${JSON.stringify(raw)}`);
    }
    return value;
}

function isWithin(parent: string, child: string): boolean {
    const withSep = parent.endsWith(sep) ? parent : parent + sep;
    return child === parent || child.startsWith(withSep);
}

/**
 * Parse process arguments and environment into a validated, frozen configuration.
 * Precedence per key: CLI argument, then environment variable, then default.
 *
 * @throws ConfigError when a value fails to parse or a cross-field rule is violated.
 *         The message names the offending key and the rejected value.
 */
export function loadConfig(argv: string[], env: NodeJS.ProcessEnv): Readonly<Config> {
    let values: Partial<Record<keyof typeof OPTIONS, string>>;
    try {
        ({ values } = parseArgs({
            args: argv.slice(2),
            options: OPTIONS,
            allowPositionals: false,
            strict: true,
        }) as { values: Partial<Record<keyof typeof OPTIONS, string>> });
    } catch (error) {
        throw new ConfigError(error instanceof Error ? error.message : String(error));
    }

    const portRaw = firstDefined(values.port, env.DOCKNIGHT_PORT) ?? "5001";
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ConfigError(`port: expected 1-65535, got ${JSON.stringify(portRaw)}`);
    }

    const hostname = firstDefined(values.hostname, env.DOCKNIGHT_HOSTNAME);

    const dataDir = resolve(
        firstDefined(values["data-dir"], env.DOCKNIGHT_DATA_DIR) ?? "/app/data",
    );
    const stacksDir = resolve(
        firstDefined(values["stacks-dir"], env.DOCKNIGHT_STACKS_DIR) ?? "/opt/stacks",
    );
    if (dataDir === stacksDir || isWithin(dataDir, stacksDir) || isWithin(stacksDir, dataDir)) {
        throw new ConfigError(
            `dataDir and stacksDir must not overlap: ${dataDir} and ${stacksDir}`,
        );
    }

    const sslKey = firstDefined(values["ssl-key"], env.DOCKNIGHT_SSL_KEY);
    const sslCert = firstDefined(values["ssl-cert"], env.DOCKNIGHT_SSL_CERT);
    if ((sslKey === undefined) !== (sslCert === undefined)) {
        throw new ConfigError("sslKey and sslCert must be set together");
    }
    const sslKeyPassphrase = firstDefined(
        values["ssl-key-passphrase"],
        env.DOCKNIGHT_SSL_KEY_PASSPHRASE,
    );

    const puid = parseUid(env.PUID, "PUID");
    const pgid = parseUid(env.PGID, "PGID");
    if ((puid === undefined) !== (pgid === undefined)) {
        throw new ConfigError("PUID and PGID must be set together");
    }

    const enableConsole = parseBool(
        firstDefined(values["enable-console"], env.DOCKNIGHT_ENABLE_CONSOLE),
        false,
    );

    const logLevelRaw = firstDefined(values["log-level"], env.DOCKNIGHT_LOG_LEVEL) ?? "info";
    if (!LOG_LEVELS.includes(logLevelRaw as LogLevel)) {
        throw new ConfigError(
            `logLevel: expected one of ${LOG_LEVELS.join(", ")}, got ${JSON.stringify(logLevelRaw)}`,
        );
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
        versionManifestUrl: env.DOCKNIGHT_VERSION_MANIFEST_URL ?? DEFAULT_VERSION_MANIFEST_URL,
    });
}
