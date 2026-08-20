import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { clientIp, makeBucket } from "./rate-limit.ts";
import type { Conn } from "./ws/conn.ts";

test("a bucket allows its capacity and then refuses", () => {
    const bucket = makeBucket(3, 60);
    assert.ok(bucket.take("ip"));
    assert.ok(bucket.take("ip"));
    assert.ok(bucket.take("ip"));
    assert.ok(!bucket.take("ip"));
});

test("buckets are keyed, so one address cannot exhaust another", () => {
    const bucket = makeBucket(1, 60);
    assert.ok(bucket.take("a"));
    assert.ok(!bucket.take("a"));
    assert.ok(bucket.take("b"));
});

test("refill math: tokens accrue at the configured rate per minute", () => {
    mock.timers.enable({ apis: ["Date"] });
    try {
        const bucket = makeBucket(2, 60); // 60 per minute = 1 token per second
        assert.ok(bucket.take("ip"));
        assert.ok(bucket.take("ip"));
        assert.ok(!bucket.take("ip"));

        mock.timers.tick(500); // half a second: half a token back, still below 1
        assert.ok(!bucket.take("ip"));

        mock.timers.tick(501); // now a full second has passed since empty: one token accrued
        assert.ok(bucket.take("ip"));
        assert.ok(!bucket.take("ip"));
    } finally {
        mock.timers.reset();
    }
});

test("refill never exceeds capacity", () => {
    mock.timers.enable({ apis: ["Date"] });
    try {
        const bucket = makeBucket(2, 60);
        bucket.take("ip");
        mock.timers.tick(10 * 60_000); // far more than enough to overflow if unclamped
        assert.ok(bucket.take("ip"));
        assert.ok(bucket.take("ip"));
        assert.ok(!bucket.take("ip"), "capacity of 2 must not be exceeded");
    } finally {
        mock.timers.reset();
    }
});

test("eviction drops entries idle past ten minutes, keeps fresh ones", () => {
    mock.timers.enable({ apis: ["Date"] });
    try {
        const bucket = makeBucket(1, 60);
        bucket.take("stale");
        mock.timers.tick(10 * 60_000 + 1);
        bucket.take("fresh");
        assert.equal(bucket.size(), 2);
        bucket.evict();
        assert.equal(bucket.size(), 1);
    } finally {
        mock.timers.reset();
    }
});

function connWith(remoteAddress: string, forwardedFor: string | undefined): Conn {
    return { remoteAddress, forwardedFor } as Conn;
}

test("clientIp uses the raw socket address when trustProxy is off", () => {
    const conn = connWith("10.0.0.5", "203.0.113.9, 10.0.0.1");
    assert.equal(clientIp(conn, false), "10.0.0.5");
});

test("clientIp honours X-Forwarded-For only when trustProxy is on", () => {
    const conn = connWith("10.0.0.5", "203.0.113.9, 10.0.0.1");
    assert.equal(clientIp(conn, true), "203.0.113.9");
});

test("clientIp falls back to the socket address when there is no forwarded header", () => {
    const conn = connWith("10.0.0.5", undefined);
    assert.equal(clientIp(conn, true), "10.0.0.5");
});
