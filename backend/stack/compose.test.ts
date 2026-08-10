import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJsonRecords } from "./compose.ts";

test("parseJsonRecords reads the array shape", () => {
    const records = parseJsonRecords<{ Name: string }>('[{"Name":"a"},{"Name":"b"}]');
    assert.deepEqual(records.map((record) => record.Name), ["a", "b"]);
});

test("parseJsonRecords reads the object-per-line shape", () => {
    const records = parseJsonRecords<{ Name: string }>('{"Name":"a"}\n{"Name":"b"}\n');
    assert.deepEqual(records.map((record) => record.Name), ["a", "b"]);
});

test("a line that does not parse is skipped rather than fatal", () => {
    const records = parseJsonRecords<{ Name: string }>('{"Name":"a"}\nnot json\n{"Name":"b"}');
    assert.deepEqual(records.map((record) => record.Name), ["a", "b"]);
});

test("empty output is an empty list", () => {
    assert.deepEqual(parseJsonRecords("   \n"), []);
    assert.deepEqual(parseJsonRecords(""), []);
});
