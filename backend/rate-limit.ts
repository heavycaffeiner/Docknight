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

/**
 * A token bucket per key, in memory. `capacity` is the burst; `refillPerMinute` is the rate.
 */
export function createTokenBucket(capacity: number, refillPerMinute: number): TokenBucket {
    const buckets = new Map<string, Bucket>();
    const perMs = refillPerMinute / 60_000;

    return {
        take(key: string): boolean {
            const now = Date.now();
            const existing = buckets.get(key);
            const bucket =
                existing === undefined
                    ? { tokens: capacity, at: now }
                    : {
                          tokens: Math.min(capacity, existing.tokens + (now - existing.at) * perMs),
                          at: now,
                      };
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

export const loginBucket = createTokenBucket(20, 20);
export const totpBucket = createTokenBucket(30, 30);

let evictTimer: NodeJS.Timeout | null = null;

export function startEviction(): void {
    if (evictTimer !== null) return;
    evictTimer = setInterval(() => {
        loginBucket.evict();
        totpBucket.evict();
    }, EVICT_AFTER_MS);
    evictTimer.unref();
}

export function stopEviction(): void {
    if (evictTimer !== null) clearInterval(evictTimer);
    evictTimer = null;
}
