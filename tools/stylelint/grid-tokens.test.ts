import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import stylelint from "stylelint";

const pluginPath = fileURLToPath(new URL("./grid-tokens.mjs", import.meta.url));

async function lint(code: string): Promise<string[]> {
    const result = await stylelint.lint({
        code,
        config: {
            plugins: [pluginPath],
            rules: { "docknight/grid-tokens": true },
        },
    });
    return result.results.flatMap((r) => r.warnings.map((w) => w.text));
}

test("accepts a token reference on a spatial property", async () => {
    assert.deepEqual(await lint(".a { padding: var(--space-4); }"), []);
});

test("rejects a raw px length on a spatial property, naming the nearest token", async () => {
    const warnings = await lint(".a { padding: 14px; }");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /--space-3/);
});

test("accepts the documented keywords", async () => {
    for (const value of ["0", "auto", "100%", "min-content", "max-content", "fit-content"]) {
        assert.deepEqual(await lint(`.a { width: ${value}; }`), [], `expected ${value} to pass`);
    }
});

test("accepts an fr value", async () => {
    assert.deepEqual(await lint(".a { width: 1fr; }"), []);
});

test("accepts a raw px length only on border and outline widths", async () => {
    assert.deepEqual(await lint(".a { border-width: 1px; }"), []);
    assert.deepEqual(await lint(".a { outline-width: 2px; }"), []);
    const rejected = await lint(".a { border-radius: 1px; }");
    assert.equal(rejected.length, 1);
});

test("accepts calc() built from tokens and keywords", async () => {
    assert.deepEqual(await lint(".a { width: calc(100% - var(--space-4)); }"), []);
});

test("accepts a unitless scalar multiplier inside calc()", async () => {
    assert.deepEqual(await lint(".a { margin-inline-start: calc(-1 * var(--optical-inset)); }"), []);
});

test("rejects calc() with a raw px operand", async () => {
    const warnings = await lint(".a { width: calc(100% - 14px); }");
    assert.equal(warnings.length, 1);
});

test("rejects an unapproved custom property", async () => {
    const warnings = await lint(".a { padding: var(--not-a-real-token); }");
    assert.equal(warnings.length, 1);
});

test("non-spatial properties are not checked", async () => {
    assert.deepEqual(await lint(".a { color: red; font-size: 14px; }"), []);
});
