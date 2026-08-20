import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import stylelint from "stylelint";

const pluginPath = fileURLToPath(new URL("./logical-properties.mjs", import.meta.url));

async function lint(code: string): Promise<string[]> {
    const result = await stylelint.lint({
        code,
        config: {
            plugins: [pluginPath],
            rules: { "docknight/logical-properties": true },
        },
    });
    return result.results.flatMap((r) => r.warnings.map((w) => w.text));
}

test("rejects margin-left, suggesting margin-inline-start", async () => {
    const warnings = await lint(".a { margin-left: 4px; }");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /margin-inline-start/);
});

test("rejects padding-right, suggesting padding-inline-end", async () => {
    const warnings = await lint(".a { padding-right: 4px; }");
    assert.match(warnings[0] ?? "", /padding-inline-end/);
});

test("rejects left and right", async () => {
    assert.equal((await lint(".a { left: 0; }")).length, 1);
    assert.equal((await lint(".a { right: 0; }")).length, 1);
});

test("rejects text-align left and right", async () => {
    assert.equal((await lint(".a { text-align: left; }")).length, 1);
    assert.equal((await lint(".a { text-align: right; }")).length, 1);
});

test("accepts text-align start and end", async () => {
    assert.deepEqual(await lint(".a { text-align: start; }"), []);
    assert.deepEqual(await lint(".a { text-align: end; }"), []);
});

test("accepts the logical equivalents", async () => {
    assert.deepEqual(await lint(".a { margin-inline-start: 4px; inset-inline-start: 0; }"), []);
});

test("rejects the four corner radius properties", async () => {
    const warnings = await lint(".a { border-top-left-radius: 4px; }");
    assert.match(warnings[0] ?? "", /border-start-start-radius/);
});
