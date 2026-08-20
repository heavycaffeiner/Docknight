import { all, one, run, tx } from "./db/index.ts";
import { log } from "./log.ts";

const CACHE_TTL_MS = 60_000;

interface Entry {
    value: unknown;
    at: number;
}

interface SettingRow {
    key: string;
    value: string;
    type: string | null;
}

const cache = new Map<string, Entry>();
let sweeper: NodeJS.Timeout | null = null;

function parseValue(raw: string, key: string): unknown {
    try {
        return JSON.parse(raw);
    } catch (error) {
        log.warn("settings", `${key} does not hold JSON, treating it as absent`, error);
        return undefined;
    }
}

function readCached(key: string): { hit: true; value: unknown } | { hit: false } {
    const cached = cache.get(key);
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
        return { hit: true, value: cached.value };
    }
    return { hit: false };
}

export const Settings = {
    /** Read one setting. Cache hit within 60 s, otherwise one indexed lookup. */
    get(key: string): unknown {
        const cached = readCached(key);
        if (cached.hit) return cached.value;
        const row = one<SettingRow>("SELECT value FROM setting WHERE key = :key", { key });
        const value = row === undefined ? undefined : parseValue(row.value, key);
        cache.set(key, { value, at: Date.now() });
        return value;
    },

    /** Write one setting and invalidate its cache entry. */
    set(key: string, value: unknown, type: string): void {
        run(
            `INSERT INTO setting (key, value, type) VALUES (:key, :value, :type)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            { key, value: JSON.stringify(value), type },
        );
        cache.delete(key);
    },

    getGroup(type: string): Record<string, unknown> {
        const rows = all<SettingRow>("SELECT key, value, type FROM setting WHERE type = :type", { type });
        const out: Record<string, unknown> = {};
        for (const row of rows) {
            const value = parseValue(row.value, row.key);
            if (value !== undefined) out[row.key] = value;
        }
        return out;
    },

    /**
     * Write a group in one transaction. A key already carrying a different type is skipped, so
     * a request cannot move an internal row into a user-editable group.
     */
    setGroup(type: string, values: Record<string, unknown>): void {
        tx(() => {
            for (const [key, value] of Object.entries(values)) {
                const existing = one<SettingRow>("SELECT type FROM setting WHERE key = :key", { key });
                if (existing !== undefined && existing.type !== null && existing.type !== type) {
                    log.warn("settings", `refusing to write ${key}, it belongs to group ${existing.type}`);
                    continue;
                }
                run(
                    `INSERT INTO setting (key, value, type) VALUES (:key, :value, :type)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type`,
                    { key, value: JSON.stringify(value), type },
                );
            }
        });
        for (const key of Object.keys(values)) cache.delete(key);
    },
};

export function startSettingsCacheSweeper(): () => void {
    if (sweeper === null) {
        sweeper = setInterval(() => {
            const cutoff = Date.now() - CACHE_TTL_MS;
            for (const [key, entry] of cache) {
                if (entry.at < cutoff) cache.delete(key);
            }
        }, CACHE_TTL_MS);
        sweeper.unref();
    }
    return () => {
        if (sweeper !== null) clearInterval(sweeper);
        sweeper = null;
        cache.clear();
    };
}
