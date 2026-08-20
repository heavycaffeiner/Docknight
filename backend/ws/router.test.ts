import assert from "node:assert/strict";
import { test } from "node:test";
import { clearRegistryForTests, method, registeredMethods } from "./router.ts";

test("registering a method name twice throws at startup", () => {
    clearRegistryForTests();
    method("dup.method", {
        requiresAuth: false,
        routable: false,
        parse: (raw) => raw,
        handle: () => ({ ok: true }),
    });
    assert.throws(
        () =>
            method("dup.method", {
                requiresAuth: false,
                routable: false,
                parse: (raw) => raw,
                handle: () => ({ ok: true }),
            }),
        /registered twice/,
    );
    assert.deepEqual(registeredMethods(), ["dup.method"]);
    clearRegistryForTests();
});
