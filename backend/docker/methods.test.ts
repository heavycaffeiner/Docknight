import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJsonLines, parsePruneOutput } from "./methods.ts";

const ROW_FIELDS = ["Name", "Labels", "Size", "Names"] as const;
const ROW_IDENTITY_FIELDS = ["Name"] as const;

test("parseJsonLines reads one object per line", () => {
    const rows = parseJsonLines('{"Name":"a"}\n{"Name":"b"}\n', ROW_FIELDS, ROW_IDENTITY_FIELDS);
    assert.deepEqual(rows, [{ Name: "a" }, { Name: "b" }]);
});

test("parseJsonLines skips a malformed line instead of failing the listing", () => {
    const rows = parseJsonLines(
        '{"Name":"a"}\nnot json\n{"Name":"c"}',
        ROW_FIELDS,
        ROW_IDENTITY_FIELDS,
    );
    assert.deepEqual(rows, [{ Name: "a" }, { Name: "c" }]);
});

test("parseJsonLines on empty output yields nothing", () => {
    assert.deepEqual(parseJsonLines("   \n\n", ROW_FIELDS, ROW_IDENTITY_FIELDS), []);
});

test("parseJsonLines keeps known strings and rejects malformed identities", () => {
    const rows = parseJsonLines(
        [
            '{"Name":"safe","Labels":7,"Size":{},"Names":["bad"],"Extra":"drop"}',
            '{"Name":42,"Labels":null}',
            '{"Name":"   ","Labels":"valid"}',
            "null",
            "[]",
            '"text"',
        ].join("\n"),
        ROW_FIELDS,
        ROW_IDENTITY_FIELDS,
    );
    assert.deepEqual(rows, [{ Name: "safe" }]);
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
