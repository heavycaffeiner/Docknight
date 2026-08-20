import assert from "node:assert/strict";
import { test } from "node:test";
import { convertStatus, CREATED, EXITED, RUNNING, UNKNOWN } from "./stack.ts";

const CASES: [string, number][] = [
    ["running(1)", RUNNING],
    ["running(2)", RUNNING],
    ["exited(0)", EXITED],
    ["exited(1)", EXITED],
    ["exited(1), running(1)", EXITED],
    ["created", CREATED],
    ["created(1)", CREATED],
    ["restarting(1)", UNKNOWN],
    ["removing(1)", UNKNOWN],
    ["paused(1)", UNKNOWN],
    ["", UNKNOWN],
    ["RUNNING(2)", RUNNING],
    ["Exited(137)", EXITED],
];

for (const [text, expected] of CASES) {
    test(`convertStatus(${JSON.stringify(text)}) -> ${expected}`, () => {
        assert.equal(convertStatus(text), expected);
    });
}
