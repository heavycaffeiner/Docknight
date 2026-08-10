import type { Rule, Violation } from "./types.ts";
import { highlightOf } from "./shared.ts";

/**
 * Spacing and radius only. Margins are excluded because `auto` resolves to a used value that is
 * legitimately fractional, and widths and heights are excluded because a flex or grid child's
 * computed extent is content-driven. Checking either would report failures that are not failures.
 */
const PROPERTIES = [
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "row-gap",
    "column-gap",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
] as const;

const TOKEN_PREFIXES = ["--space-", "--size-", "--radius-", "--measure-"];
const TOKEN_NAMES = ["--hairline", "--focus-ring"];

/**
 * A fully round corner is written `calc(infinity * 1px)`, which Chrome computes to 2^25 and then
 * reports in exponent notation, so it does not read back as exactly that. It is a shape rather than
 * a measurement, and no real radius comes near this, so anything past it is allowed on a corner.
 */
const FULL_ROUND = 10000;

let cached: number[] | null = null;

/**
 * Read the token values out of the loaded stylesheets so the rule and the stylesheet cannot drift.
 * A stylesheet from another origin throws on cssRules and is skipped.
 */
function allowedLengths(unit: number): number[] {
    if (cached !== null) return cached;
    const values = new Set<number>([0]);
    const root = getComputedStyle(document.documentElement);

    for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }
        for (const rule of rules) {
            if (!(rule instanceof CSSStyleRule)) continue;
            for (const property of rule.style) {
                if (!property.startsWith("--")) continue;
                const named =
                    TOKEN_NAMES.includes(property) ||
                    TOKEN_PREFIXES.some((prefix) => property.startsWith(prefix));
                if (!named) continue;
                const resolved = root.getPropertyValue(property).trim();
                if (!resolved.endsWith("px")) continue;
                const length = Number(resolved.slice(0, -2));
                if (!Number.isNaN(length)) values.add(length);
            }
        }
    }

    // No readable stylesheet means the grid itself is the only thing left to assert.
    if (values.size <= 1) {
        for (let step = 0; step <= 64; step += 1) values.add(step * unit);
    }
    cached = [...values].sort((a, b) => a - b);
    return cached;
}

function nearest(value: number, allowed: number[]): number {
    let best = allowed[0] as number;
    for (const candidate of allowed) {
        if (Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
    }
    return best;
}

export const tokenUsage: Rule = {
    name: "token-usage",
    check(nodes, options) {
        const violations: Violation[] = [];
        const allowed = allowedLengths(options.unit);

        for (const measured of nodes) {
            for (const property of PROPERTIES) {
                const raw = measured.style.getPropertyValue(property);
                if (!raw.endsWith("px")) continue;
                const value = Number(raw.slice(0, -2));
                if (Number.isNaN(value) || value === 0) continue;
                if (value >= FULL_ROUND && property.startsWith("border-")) continue;
                const match = allowed.some(
                    (candidate) => Math.abs(candidate - value) <= options.tolerance,
                );
                if (match) continue;
                violations.push({
                    rule: "token-usage",
                    severity: "error",
                    path: measured.path,
                    message: `${property} is ${raw}, which is not a token value`,
                    measured: raw,
                    expected: `${nearest(value, allowed)}px`,
                    highlight: highlightOf(measured.rect),
                });
            }
        }
        return violations;
    },
};
