import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJsonLines, parsePruneOutput } from "./methods.ts";

interface Row {
    Name?: string;
}

test("parseJsonLines reads one object per line", () => {
    const rows = parseJsonLines<Row>('{"Name":"a"}\n{"Name":"b"}\n');
    assert.deepEqual(rows, [{ Name: "a" }, { Name: "b" }]);
});

test("parseJsonLines skips a malformed line instead of failing the listing", () => {
    const rows = parseJsonLines<Row>('{"Name":"a"}\nnot json\n{"Name":"c"}');
    assert.deepEqual(rows, [{ Name: "a" }, { Name: "c" }]);
});

test("parseJsonLines on empty output yields nothing", () => {
    assert.deepEqual(parseJsonLines<Row>("   \n\n"), []);
});

test("parsePruneOutput reads the reclaimed total and counts deletions", () => {
    const out = [
        "Deleted Images:",
        "untagged: nginx:1.25",
        "deleted: sha256:aaaa",
        "deleted: sha256:bbbb",
        "",
        "Total reclaimed space: 187.4MB",
    ].join("\n");
    const result = parsePruneOutput(out);
    assert.equal(result.reclaimed, "187.4MB");
    assert.equal(result.reclaimedBytes, 187_400_000);
    assert.equal(result.deleted, 3);
});

test("parsePruneOutput on a no-op prune reports zero", () => {
    const result = parsePruneOutput("Total reclaimed space: 0B\n");
    assert.equal(result.reclaimedBytes, 0);
    assert.equal(result.deleted, 0);
});
