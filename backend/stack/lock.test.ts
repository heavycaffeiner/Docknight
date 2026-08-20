import assert from "node:assert/strict";
import { test } from "node:test";
import { withStackLock } from "./lock.ts";

test("a second call for the same name while the first is in flight is refused", async () => {
    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });

    const first = withStackLock("demo", async () => {
        await gate;
        return "first";
    });

    assert.throws(
        () => {
            void withStackLock("demo", async () => "second");
        },
        (error: unknown) => error instanceof Error && error.message.includes("operation"),
    );

    releaseFirst();
    assert.equal(await first, "first");
});

test("the lock releases after completion, so a later call for the same name succeeds", async () => {
    await withStackLock("demo2", async () => "one");
    const second = await withStackLock("demo2", async () => "two");
    assert.equal(second, "two");
});

test("the lock releases after a rejection, so the name is not stuck locked", async () => {
    await assert.rejects(
        withStackLock("demo3", async () => {
            throw new Error("boom");
        }),
    );
    const after = await withStackLock("demo3", async () => "recovered");
    assert.equal(after, "recovered");
});

test("different names do not contend for the same lock", async () => {
    let releaseA: () => void = () => undefined;
    const gateA = new Promise<void>((resolve) => {
        releaseA = resolve;
    });
    const a = withStackLock("a", async () => {
        await gateA;
        return "a";
    });
    const b = await withStackLock("b", async () => "b");
    assert.equal(b, "b");
    releaseA();
    assert.equal(await a, "a");
});
