import assert from "node:assert/strict";
import { test } from "node:test";
import { groupServiceStatus, parsePsOutput } from "./methods.ts";

test("parsePsOutput handles a single JSON array", () => {
    const out = JSON.stringify([
        { Service: "web", Name: "demo-web-1", State: "running" },
        { Service: "db", Name: "demo-db-1", State: "running" },
    ]);
    const records = parsePsOutput(out);
    assert.equal(records.length, 2);
    assert.equal(records[0]?.Service, "web");
});

test("parsePsOutput handles one JSON object per line", () => {
    const out = [
        JSON.stringify({ Service: "web", Name: "demo-web-1", State: "running" }),
        JSON.stringify({ Service: "db", Name: "demo-db-1", Health: "healthy" }),
    ].join("\n");
    const records = parsePsOutput(out);
    assert.equal(records.length, 2);
    assert.equal(records[1]?.Health, "healthy");
});

test("parsePsOutput skips a garbage line without failing the whole call", () => {
    const out = [
        JSON.stringify({ Service: "web", Name: "demo-web-1", State: "running" }),
        "not json at all",
        JSON.stringify({ Service: "db", Name: "demo-db-1", State: "running" }),
    ].join("\n");
    const records = parsePsOutput(out);
    assert.equal(records.length, 2);
});

test("parsePsOutput returns an empty array for blank output", () => {
    assert.deepEqual(parsePsOutput(""), []);
    assert.deepEqual(parsePsOutput("   \n  \n"), []);
});

test("parsePsOutput returns an empty array when the JSON array does not parse", () => {
    assert.deepEqual(parsePsOutput("[not valid json"), []);
});

test("groupServiceStatus groups multiple containers under one service", () => {
    const records = [
        { Service: "web", Name: "demo-web-1", State: "running" },
        { Service: "web", Name: "demo-web-2", State: "running" },
        { Service: "db", Name: "demo-db-1", State: "running" },
    ];
    const grouped = groupServiceStatus(records);
    assert.equal(grouped.web?.length, 2);
    assert.equal(grouped.db?.length, 1);
});

test("groupServiceStatus prefers Health over State when both are present", () => {
    const grouped = groupServiceStatus([
        { Service: "web", Name: "demo-web-1", State: "running", Health: "healthy" },
    ]);
    assert.equal(grouped.web?.[0]?.status, "healthy");
});

test("groupServiceStatus falls back to State when Health is absent", () => {
    const grouped = groupServiceStatus([{ Service: "web", Name: "demo-web-1", State: "running" }]);
    assert.equal(grouped.web?.[0]?.status, "running");
});

test("groupServiceStatus skips a record with no Service field", () => {
    const grouped = groupServiceStatus([{ Name: "orphan", State: "running" }]);
    assert.deepEqual(grouped, {});
});
