import { inspect } from "node:util";
import type { LogLevel } from "./config.ts";

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const REDACTED_KEY = /pass|secret|token|authorization/i;
const REDACTED = "[redacted]";

let threshold = ORDER.info;

export function initLogging(level: LogLevel): void {
    threshold = ORDER[level];
}

/**
 * Replace values under credential-looking keys before formatting, so a caller cannot leak a
 * credential by logging a whole request object.
 */
function redact(value: unknown, seen: WeakSet<object>): unknown {
    if (typeof value !== "object" || value === null) return value;
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) return value.map((item) => redact(item, seen));
    if (value instanceof Error) return value;
    if (value instanceof Date || value instanceof RegExp) return value;
    if (value instanceof Map || value instanceof Set) return value;

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        out[key] = REDACTED_KEY.test(key) ? REDACTED : redact(item, seen);
    }
    return out;
}

function format(value: unknown): string {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
    return inspect(redact(value, new WeakSet()), { depth: 3, colors: false, breakLength: 160 });
}

function write(level: LogLevel, scope: string, args: unknown[]): void {
    if (ORDER[level] < threshold) return;
    let line: string;
    try {
        const body = args.map(format).join(" ");
        line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${body}`;
    } catch {
        // The logger never throws. A formatting failure logs the raw string form and continues.
        line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${String(args)}`;
    }
    const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
    stream.write(line + "\n");
}

export const log = {
    debug: (scope: string, ...args: unknown[]): void => write("debug", scope, args),
    info: (scope: string, ...args: unknown[]): void => write("info", scope, args),
    warn: (scope: string, ...args: unknown[]): void => write("warn", scope, args),
    error: (scope: string, ...args: unknown[]): void => write("error", scope, args),
};
