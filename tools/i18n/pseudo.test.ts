import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generate } from "./pseudo.ts";

const EN_PATH = fileURLToPath(new URL("../../frontend/src/locales/en.json", import.meta.url));
const en = JSON.parse(readFileSync(EN_PATH, "utf8")) as Record<string, string>;

test("every key from en.json is present in the generated catalogue", () => {
    const out = generate();
    for (const key of Object.keys(en)) {
        assert.ok(key in out, `expected ${key} to be present`);
    }
});

test("every generated string is at least 140% of its English source length", () => {
    const out = generate();
    for (const [key, value] of Object.entries(en)) {
        if (key === "languageName") continue;
        const generated = out[key] as string;
        assert.ok(
            generated.length >= value.length * 1.4,
            `${key}: ${generated.length} < ${value.length * 1.4}`,
        );
    }
});

test("placeholders survive the transform untouched", () => {
    const out = generate();
    for (const [key, value] of Object.entries(en)) {
        const placeholders = value.match(/\{\w+\}/g) ?? [];
        for (const placeholder of placeholders) {
            assert.ok(
                (out[key] as string).includes(placeholder),
                `${key}: expected ${placeholder} to survive in "${out[key]}"`,
            );
        }
    }
});

test("every generated string is wrapped in brackets", () => {
    const out = generate();
    for (const [key, value] of Object.entries(out)) {
        if (key === "languageName") continue;
        assert.ok(value.startsWith("[") && value.endsWith("]"), `${key}: "${value}"`);
    }
});

test("languageName is excluded from the accent/pad transform and named for the selector filter", () => {
    const out = generate();
    assert.equal(out.languageName, "Pseudo (en-XA)");
});
