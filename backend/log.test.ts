import assert from "node:assert/strict";
import { test } from "node:test";
import { initLogging, log } from "./log.ts";

function captureStdout(fn: () => void): string {
    const original = process.stdout.write.bind(process.stdout);
    let out = "";
    process.stdout.write = ((chunk: string) => {
        out += chunk;
        return true;
    }) as typeof process.stdout.write;
    try {
        fn();
    } finally {
        process.stdout.write = original;
    }
    return out;
}

function captureStderr(fn: () => void): string {
    const original = process.stderr.write.bind(process.stderr);
    let out = "";
    process.stderr.write = ((chunk: string) => {
        out += chunk;
        return true;
    }) as typeof process.stderr.write;
    try {
        fn();
    } finally {
        process.stderr.write = original;
    }
    return out;
}

test("level filtering: debug is silent under info threshold", () => {
    initLogging("info");
    const out = captureStdout(() => log.debug("test", "should not appear"));
    assert.equal(out, "");
});

test("level filtering: info and above are written at debug threshold", () => {
    initLogging("debug");
    const out = captureStdout(() => log.info("test", "hello"));
    assert.match(out, /INFO {2}\[test] hello/);
});

test("warn and error go to stderr, debug and info go to stdout", () => {
    initLogging("debug");
    const errOut = captureStderr(() => log.warn("test", "careful"));
    assert.match(errOut, /WARN {2}\[test] careful/);
    const stdOut = captureStdout(() => log.info("test", "fine"));
    assert.match(stdOut, /INFO {2}\[test] fine/);
});

test("redaction replaces credential-looking keys at any depth", () => {
    initLogging("debug");
    const out = captureStdout(() =>
        log.info("test", { username: "a", password: "hunter2", nested: { token: "abc", ok: 1 } }),
    );
    assert.doesNotMatch(out, /hunter2/);
    assert.doesNotMatch(out, /abc/);
    assert.match(out, /\[redacted]/);
    assert.match(out, /username: 'a'/);
    assert.match(out, /ok: 1/);
});

test("redaction: a login request logged at debug never contains the password", () => {
    initLogging("debug");
    const loginRequest = {
        t: "req",
        id: 1,
        endpoint: "",
        method: "auth.login",
        params: { username: "admin", password: "hunter2" },
    };
    const out = captureStdout(() => log.debug("ws", "inbound frame", loginRequest));
    assert.doesNotMatch(out, /hunter2/);
    assert.match(out, /\[redacted]/);
    // Non-credential fields survive, so the log line is still useful for debugging.
    assert.match(out, /admin/);
    assert.match(out, /auth\.login/);
});

test("the logger never throws on a circular object", () => {
    initLogging("debug");
    const circular: Record<string, unknown> = { name: "x" };
    circular.self = circular;
    assert.doesNotThrow(() => captureStdout(() => log.info("test", circular)));
});
