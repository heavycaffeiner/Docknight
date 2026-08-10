import assert from "node:assert/strict";
import { test } from "node:test";
import { createTokenBucket } from "./rate-limit.ts";

test("a bucket allows its capacity and then refuses", () => {
    const bucket = createTokenBucket(3, 60);
    assert.ok(bucket.take("ip"));
    assert.ok(bucket.take("ip"));
    assert.ok(bucket.take("ip"));
    assert.ok(!bucket.take("ip"));
});

test("buckets are keyed, so one address cannot exhaust another", () => {
    const bucket = createTokenBucket(1, 60);
    assert.ok(bucket.take("a"));
    assert.ok(!bucket.take("a"));
    assert.ok(bucket.take("b"));
});

test("eviction bounds the map", () => {
    const bucket = createTokenBucket(1, 60);
    bucket.take("a");
    assert.equal(bucket.size(), 1);
    bucket.evict();
    // Fresh entries survive an immediate sweep; only idle ones are dropped.
    assert.equal(bucket.size(), 1);
});
