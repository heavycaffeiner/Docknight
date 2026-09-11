import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDockerSize, parseLabels } from "./docker.ts";

const SIZE_CASES: [string, number][] = [
    ["0B", 0],
    ["512B", 512],
    ["1kB", 1000],
    ["1KiB", 1024],
    ["1.5MB", 1_500_000],
    ["2MiB", 2 * 1024 * 1024],
    ["1.234GB", 1_234_000_000],
    ["3 GiB", 3 * 1024 ** 3],
    ["1TB", 1000 ** 4],
    ["N/A", 0],
    ["", 0],
    ["12", 12],
];

for (const [text, expected] of SIZE_CASES) {
    test(`parseDockerSize(${JSON.stringify(text)}) -> ${expected}`, () => {
        assert.equal(parseDockerSize(text), expected);
    });
}

test("parseLabels reads a compose-labelled container", () => {
    const labels = parseLabels(
        "com.docker.compose.project=paperless,com.docker.compose.service=webserver,maintainer=someone",
    );
    assert.equal(labels["com.docker.compose.project"], "paperless");
    assert.equal(labels["com.docker.compose.service"], "webserver");
});

test("parseLabels keeps a value containing an equals sign", () => {
    assert.equal(parseLabels("cmd=a=b").cmd, "a=b");
});

test("parseLabels ignores empty and malformed fragments", () => {
    assert.deepEqual(parseLabels(""), {});
    assert.deepEqual(parseLabels("=novalue,justakey"), {});
});
