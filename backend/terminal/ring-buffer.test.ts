import assert from "node:assert/strict";
import { test } from "node:test";
import { RingBuffer } from "./ring-buffer.ts";

test("chunk cap: pushing past maxChunks drops the oldest", () => {
    const buffer = new RingBuffer(3, 1024);
    buffer.push("a");
    buffer.push("b");
    buffer.push("c");
    buffer.push("d");
    assert.equal(buffer.join(), "bcd");
});

test("byte cap: pushing past maxBytes drops from the front", () => {
    const buffer = new RingBuffer(100, 10);
    buffer.push("12345");
    buffer.push("67890");
    buffer.push("x");
    assert.equal(buffer.join(), "67890x");
});

test("a single chunk larger than the byte cap is truncated from its front", () => {
    const buffer = new RingBuffer(100, 5);
    buffer.push("abcdefghij");
    assert.equal(buffer.join(), "fghij");
});

test("join preserves insertion order", () => {
    const buffer = new RingBuffer(100, 1024);
    buffer.push("one");
    buffer.push("two");
    buffer.push("three");
    assert.equal(buffer.join(), "onetwothree");
});
