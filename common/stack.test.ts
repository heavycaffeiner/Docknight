import assert from "node:assert/strict";
import { test } from "node:test";
import {
    CREATED,
    EXITED,
    RUNNING,
    STACK_NAME_PATTERN,
    UNKNOWN,
    convertStatus,
    stackKey,
} from "./stack.ts";

test("convertStatus reads the shapes docker compose ls emits", () => {
    assert.equal(convertStatus("running(2)"), RUNNING);
    assert.equal(convertStatus("created(1)"), CREATED);
    assert.equal(convertStatus("exited(1), running(2)"), EXITED);
    assert.equal(convertStatus("running(1), exited(1)"), EXITED);
    assert.equal(convertStatus("paused(1)"), UNKNOWN);
    assert.equal(convertStatus(""), UNKNOWN);
});

test("the stack name policy rejects names that could be read as flags or paths", () => {
    for (const good of ["immich", "a", "my-stack_2", "0", "a".repeat(63)]) {
        assert.ok(STACK_NAME_PATTERN.test(good), good);
    }
    for (const bad of ["-flag", "_leading", "Upper", "with space", "dot.dot", "a".repeat(64), "", "../etc"]) {
        assert.ok(!STACK_NAME_PATTERN.test(bad), bad);
    }
});

test("stackKey keeps two hosts with one stack name apart", () => {
    assert.notEqual(stackKey("immich", ""), stackKey("immich", "nas:5001"));
});
