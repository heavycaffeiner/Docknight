import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EN_PATH = fileURLToPath(new URL("../../frontend/src/locales/en.json", import.meta.url));
const OUT_PATH = fileURLToPath(new URL("../../frontend/src/locales/en-XA.json", import.meta.url));

const ACCENTS: Record<string, string> = {
    a: "\u00e5",
    b: "\u0253",
    c: "\u00e7",
    d: "\u00f0",
    e: "\u00e9",
    f: "\u0192",
    g: "\u011d",
    h: "\u0125",
    i: "\u00ee",
    j: "\u0135",
    k: "\u0137",
    l: "\u013a",
    m: "\u1e3f",
    n: "\u00f1",
    o: "\u00f6",
    p: "\u00fe",
    q: "\u01eb",
    r: "\u0155",
    s: "\u0161",
    t: "\u0163",
    u: "\u00fc",
    v: "\u1e7d",
    w: "\u0175",
    x: "\u1e8b",
    y: "\u00fd",
    z: "\u017e",
};

/** Map every ASCII letter to an accented look-alike, leaving `{placeholder}` tokens untouched. */
function accent(value: string): string {
    let out = "";
    let i = 0;
    while (i < value.length) {
        const char = value[i] as string;
        if (char === "{") {
            const end = value.indexOf("}", i);
            if (end === -1) {
                out += char;
                i += 1;
                continue;
            }
            out += value.slice(i, end + 1);
            i = end + 1;
            continue;
        }
        const lower = char.toLowerCase();
        const replacement = ACCENTS[lower];
        if (replacement === undefined) {
            out += char;
        } else {
            out += char === lower ? replacement : replacement.toUpperCase();
        }
        i += 1;
    }
    return out;
}

/**
 * Generate the en-XA pseudo-locale from the English catalogue: every string accented, padded to
 * at least 140% of its original length, and wrapped in brackets so truncation is visible.
 */
export function generate(): Record<string, string> {
    const en = JSON.parse(readFileSync(EN_PATH, "utf8")) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(en)) {
        if (key === "languageName") {
            // Excluded from the production locale selector: the selector filters tags
            // starting with "en-X", and this entry only needs to be legible in the overlay.
            out[key] = "Pseudo (en-XA)";
            continue;
        }
        const accented = accent(value);
        const padCount = Math.ceil(value.length * 0.4);
        out[key] = `[${accented}${"~".repeat(padCount)}]`;
    }
    return out;
}

function main(): void {
    const catalogue = generate();
    writeFileSync(OUT_PATH, `${JSON.stringify(catalogue, null, 4)}\n`, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
