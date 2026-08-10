import assert from "node:assert/strict";
import { test } from "node:test";
import { endpointOf, normaliseUrl } from "./store.ts";

test("normaliseUrl lowercases the scheme, drops a default port and a trailing slash", () => {
    assert.equal(normaliseUrl("HTTP://nas:5001/"), "http://nas:5001");
    assert.equal(normaliseUrl("http://nas:80"), "http://nas");
    assert.equal(normaliseUrl("https://nas:443/"), "https://nas");
    assert.equal(normaliseUrl("https://nas:5001"), "https://nas:5001");
    assert.equal(normaliseUrl("  https://nas  "), "https://nas");
});

test("normaliseUrl refuses anything that is not http or https", () => {
    for (const bad of ["ws://nas", "ftp://nas", "nas:5001", "", "not a url", "file:///etc"]) {
        assert.throws(() => normaliseUrl(bad), /invalidAgentUrl|not a URL|not http/, bad);
    }
});

test("the endpoint is host and port, derived rather than stored", () => {
    assert.equal(endpointOf("https://nas:5001"), "nas:5001");
    assert.equal(endpointOf("http://nas"), "nas");
});
