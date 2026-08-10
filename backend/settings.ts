import {
    GENERAL_SETTINGS_DEFAULTS,
    GENERAL_SETTINGS_GROUP,
    type GeneralSettings,
} from "../common/protocol.ts";
import { all, one, run, tx } from "./db/index.ts";
import { log } from "./log.ts";

const CACHE_TTL_MS = 60_000;

interface Entry {
    value: unknown;
    at: number;
}

const cache = new Map<string, Entry>();
let sweeper: NodeJS.Timeout | null = null;

interface SettingRow {
    key: string;
    value: string;
    type: string | null;
}

function parse(raw: string, key: string): unknown {
    try {
        return JSON.parse(raw);
    } catch (error) {
        log.warn("settings", `${key} does not hold JSON, treating it as absent`, error);
        return undefined;
    }
}

/** Read one setting. Cache hit within 60 s, otherwise one indexed lookup. */
export function get<T>(key: string, fallback: T): T {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached.value === undefined ? fallback : (cached.value as T);
    }
    const row = one<SettingRow>("SELECT key, value, type FROM setting WHERE key = :key", { key });
    const value = row === undefined ? undefined : parse(row.value, key);
    cache.set(key, { value, at: Date.now() });
    return value === undefined ? fallback : (value as T);
}

/** Write one setting and invalidate its cache entry. */
export function set(key: string, value: unknown, type: string | null = null): void {
    run(
        `INSERT INTO setting(key, value, type) VALUES (:key, :value, :type)
         ON CONFLICT(key) DO UPDATE SET value = :value, type = COALESCE(setting.type, :type)`,
        { key, value: JSON.stringify(value), type },
    );
    cache.delete(key);
}

export function getGroup(type: string): Record<string, unknown> {
    const rows = all<SettingRow>("SELECT key, value, type FROM setting WHERE type = :type", { type });
    const out: Record<string, unknown> = {};
    for (const row of rows) {
        const value = parse(row.value, row.key);
        if (value !== undefined) out[row.key] = value;
    }
    return out;
}

/**
 * Write a group in one transaction. A key already carrying a different type is skipped, so a
 * request cannot move an internal row into a user-editable group.
 */
export function setGroup(type: string, values: Record<string, unknown>): void {
    tx(() => {
        for (const [key, value] of Object.entries(values)) {
            const existing = one<SettingRow>("SELECT key, value, type FROM setting WHERE key = :key", {
                key,
            });
            if (existing !== undefined && existing.type !== null && existing.type !== type) {
                log.warn("settings", `refusing to write ${key}, it belongs to group ${existing.type}`);
                continue;
            }
            run(
                `INSERT INTO setting(key, value, type) VALUES (:key, :value, :type)
                 ON CONFLICT(key) DO UPDATE SET value = :value, type = :type`,
                { key, value: JSON.stringify(value), type },
            );
            cache.delete(key);
        }
    });
}

/** The general group with every default filled in, which is what the UI and the server read. */
export function generalSettings(): GeneralSettings {
    const stored = getGroup(GENERAL_SETTINGS_GROUP);
    return {
        disableAuth: readBoolean(stored.disableAuth, GENERAL_SETTINGS_DEFAULTS.disableAuth),
        primaryHostname: readString(stored.primaryHostname, GENERAL_SETTINGS_DEFAULTS.primaryHostname),
        checkUpdate: readBoolean(stored.checkUpdate, GENERAL_SETTINGS_DEFAULTS.checkUpdate),
        checkBeta: readBoolean(stored.checkBeta, GENERAL_SETTINGS_DEFAULTS.checkBeta),
        trustProxy: readBoolean(stored.trustProxy, GENERAL_SETTINGS_DEFAULTS.trustProxy),
    };
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

export function startCacheSweeper(): void {
    if (sweeper !== null) return;
    sweeper = setInterval(() => {
        const cutoff = Date.now() - CACHE_TTL_MS;
        for (const [key, entry] of cache) {
            if (entry.at < cutoff) cache.delete(key);
        }
    }, CACHE_TTL_MS);
    sweeper.unref();
}

export function stopCacheSweeper(): void {
    if (sweeper !== null) clearInterval(sweeper);
    sweeper = null;
    cache.clear();
}
