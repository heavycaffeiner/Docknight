import assert from "node:assert/strict";
import { test } from "node:test";
import { RingBuffer } from "./ring-buffer.ts";

test("the chunk cap drops from the front", () => {
    const buffer = new RingBuffer(3, 1024);
    for (const chunk of ["a", "b", "c", "d"]) buffer.push(chunk);
    assert.equal(buffer.join(), "bcd");
    assert.equal(buffer.chunkCount, 3);
});

test("the byte cap drops from the front independently of the chunk count", () => {
    const buffer = new RingBuffer(100, 10);
    buffer.push("1234567890");
    buffer.push("abc");
    assert.equal(buffer.join(), "abc");
    assert.ok(buffer.byteLength <= 10);
});

test("a single chunk larger than the byte cap is kept, because dropping it loses everything", () => {
    const buffer = new RingBuffer(10, 4);
    buffer.push("0123456789");
    assert.equal(buffer.join(), "0123456789");
});

test("byte length counts UTF-8 bytes, not code units", () => {
    const buffer = new RingBuffer(10, 1024);
    buffer.push("가");
    assert.equal(buffer.byteLength, 3);
});

test("clear empties both counters", () => {
    const buffer = new RingBuffer(10, 1024);
    buffer.push("abc");
    buffer.clear();
    assert.equal(buffer.join(), "");
    assert.equal(buffer.byteLength, 0);
    assert.equal(buffer.chunkCount, 0);
});
