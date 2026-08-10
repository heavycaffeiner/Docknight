import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates the two pseudo-locales Chrome names `en-XA` and `ar-XB` from the English catalogue.
 * They are build output, not translations, so they are regenerated rather than committed.
 */

const SOURCE = fileURLToPath(new URL("../../frontend/src/locales/en.json", import.meta.url));
const LOCALES = fileURLToPath(new URL("../../frontend/src/locales/", import.meta.url));

/** Target length as a fraction of the original, which is roughly what German and Finnish cost. */
const EXPANSION = 1.4;

/** Repeated to reach the target length. Chosen so the padding still reads as a word. */
const FILLER = "ŵîđĕ";

const RIGHT_TO_LEFT_MARK = "‏";
const RIGHT_TO_LEFT_OVERRIDE = "‮";
const POP_DIRECTIONAL_FORMATTING = "‬";

const ACCENTS: Record<string, string> = {
    a: "å", b: "ƀ", c: "ç", d: "đ", e: "é", f: "ƒ", g: "ğ",
    h: "ĥ", i: "î", j: "ĵ", k: "ķ", l: "ļ", m: "ṃ", n: "ñ",
    o: "ö", p: "ƥ", q: "ʠ", r: "ŗ", s: "š", t: "ţ", u: "û",
    v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž",
    A: "Å", B: "Ɓ", C: "Ç", D: "Ď", E: "É", F: "Ƒ", G: "Ğ",
    H: "Ĥ", I: "Î", J: "Ĵ", K: "Ķ", L: "Ļ", M: "Ṃ", N: "Ñ",
    O: "Ö", P: "Ƥ", Q: "Ɋ", R: "Ŗ", S: "Š", T: "Ţ", U: "Û",
    V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ž",
};

/** Split on {placeholder} runs, which must survive both transforms byte for byte. */
function segments(message: string): { text: string; literal: boolean }[] {
    const parts: { text: string; literal: boolean }[] = [];
    const pattern = /\{\w+\}/g;
    let index = 0;
    for (let match = pattern.exec(message); match !== null; match = pattern.exec(message)) {
        if (match.index > index) parts.push({ text: message.slice(index, match.index), literal: false });
        parts.push({ text: match[0], literal: true });
        index = match.index + match[0].length;
    }
    if (index < message.length) parts.push({ text: message.slice(index), literal: false });
    return parts;
}

function accent(text: string): string {
    return [...text].map((character) => ACCENTS[character] ?? character).join("");
}

function padding(length: number): string {
    const wanted = Math.max(0, Math.round(length * EXPANSION) - length);
    if (wanted === 0) return "";
    return ` ${FILLER.repeat(Math.ceil(wanted / FILLER.length)).slice(0, wanted)}`;
}

/** Accented and padded, bracketed so a clipped or truncated string is obvious at a glance. */
function accented(message: string): string {
    const body = segments(message)
        .map((part) => (part.literal ? part.text : accent(part.text)))
        .join("");
    return `[${body}${padding(message.length)}]`;
}

/**
 * Right-to-left mirror. The override runs force each non-placeholder run to render backwards, which
 * is what surfaces a layout that has hardcoded left and right.
 */
function mirrored(message: string): string {
    const body = segments(message)
        .map((part) =>
            part.literal
                ? part.text
                : `${RIGHT_TO_LEFT_OVERRIDE}${accent(part.text)}${POP_DIRECTIONAL_FORMATTING}`,
        )
        .join("");
    return `${RIGHT_TO_LEFT_MARK}[${body}]`;
}

function transform(
    source: Record<string, string>,
    convert: (message: string) => string,
    name: string,
): Record<string, string> {
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(source)) {
        // The selector shows this, so it stays readable.
        output[key] = key === "languageName" ? name : convert(value);
    }
    return output;
}

const parsed: unknown = JSON.parse(await readFile(SOURCE, "utf8"));
if (typeof parsed !== "object" || parsed === null) throw new Error(`${SOURCE} is not an object`);

const source: Record<string, string> = {};
for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") throw new Error(`${SOURCE}: ${key} is not a string`);
    source[key] = value;
}

const outputs: [string, Record<string, string>][] = [
    ["en-XA", transform(source, accented, "Pseudo-Accented")],
    ["ar-XB", transform(source, mirrored, "Pseudo-RTL")],
];

for (const [tag, catalogue] of outputs) {
    await writeFile(join(LOCALES, `${tag}.json`), `${JSON.stringify(catalogue, null, 2)}\n`, "utf8");
    console.log(`wrote ${tag}.json with ${Object.keys(catalogue).length} messages`);
}
