import type { Conn } from "./ws/conn.ts";

const EVICT_AFTER_MS = 10 * 60_000;

interface Bucket {
    tokens: number;
    at: number;
}

export interface TokenBucket {
    /** Consume one token. Returns false when the bucket is empty. */
    take(key: string): boolean;
    /** Drop entries idle for ten minutes, so the map cannot grow without bound. */
    evict(): void;
    size(): number;
}

/** A token bucket per key, in memory. `capacity` is the burst; `refillPerMinute` is the rate. */
export function makeBucket(capacity: number, refillPerMinute: number): TokenBucket {
    const buckets = new Map<string, Bucket>();
    const perMs = refillPerMinute / 60_000;

    return {
        take(key: string): boolean {
            const now = Date.now();
            const existing = buckets.get(key);
            const bucket =
                existing === undefined
                    ? { tokens: capacity, at: now }
                    : { tokens: Math.min(capacity, existing.tokens + (now - existing.at) * perMs), at: now };
            if (bucket.tokens < 1) {
                buckets.set(key, bucket);
                return false;
            }
            bucket.tokens -= 1;
            buckets.set(key, bucket);
            return true;
        },

        evict(): void {
            const cutoff = Date.now() - EVICT_AFTER_MS;
            for (const [key, bucket] of buckets) {
                if (bucket.at < cutoff) buckets.delete(key);
            }
        },

        size(): number {
            return buckets.size;
        },
    };
}

let evictTimer: NodeJS.Timeout | null = null;
const managedBuckets: TokenBucket[] = [];

/** Register a bucket with the shared eviction sweep. */
export function manage(bucket: TokenBucket): TokenBucket {
    managedBuckets.push(bucket);
    return bucket;
}

export function startEviction(): () => void {
    if (evictTimer === null) {
        evictTimer = setInterval(() => {
            for (const bucket of managedBuckets) bucket.evict();
        }, EVICT_AFTER_MS);
        evictTimer.unref();
    }
    return () => {
        if (evictTimer !== null) clearInterval(evictTimer);
        evictTimer = null;
    };
}

/**
 * Resolve the client address for rate-limit and log purposes. `X-Forwarded-For` is honoured
 * only when `trustProxy` is true, because otherwise a client could choose its own bucket.
 */
export function clientIp(conn: Conn, trustProxy: boolean): string {
    if (trustProxy && conn.forwardedFor !== undefined) {
        const first = conn.forwardedFor.split(",")[0]?.trim();
        if (first !== undefined && first !== "") return first;
    }
    return conn.remoteAddress;
}
