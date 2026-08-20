import type { Measured, Rule, Violation } from "./types.ts";

// width, height, their min/max variants, and top/right/bottom/left are deliberately absent:
// getComputedStyle always resolves them to a used-value pixel length, even for "width: 100%",
// "width: auto", or a position: absolute element whose declared inset only sets one physical
// side (the opposite side reports the pixel gap the layout produced, not the "auto" that was
// actually declared). There is no way to tell a declared raw px length apart from a perfectly
// legitimate content- or layout-driven value at this layer; that check belongs to the static
// stylelint rule, which reads the declared value before the browser resolves it. This rule
// instead covers the properties that stay meaningful measured from computed style: margins,
// padding, gaps, and corner radii.
const SPATIAL_PROPS = [
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "gap",
    "row-gap",
    "column-gap",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
] as const;

// The runtime counterpart of tools/stylelint/tokens.json's px-valued entries, duplicated here
// rather than imported: the stylelint rule reads the raw CSS text, this one reads resolved
// pixel values from getComputedStyle, and the two only ever need to agree on the numbers.
const TOKEN_PX_VALUES = [4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80];

function nearestToken(px: number): number {
    return TOKEN_PX_VALUES.reduce((best, candidate) =>
        Math.abs(candidate - px) < Math.abs(best - px) ? candidate : best,
    );
}

function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function checkNode(node: Measured, tolerance: number): Violation[] {
    const out: Violation[] = [];
    for (const prop of SPATIAL_PROPS) {
        const raw = node.style.getPropertyValue(prop);
        if (raw === "" || raw === "auto" || raw.endsWith("%") || raw === "0px") continue;
        const px = Number.parseFloat(raw);
        if (!Number.isFinite(px) || px === 0) continue;
        const nearest = nearestToken(px);
        if (Math.abs(px - nearest) > tolerance) {
            out.push({
                rule: "token-usage",
                severity: "error",
                path: node.path,
                message: `${prop} computed to ${px}px, not a spacing token`,
                measured: px,
                expected: nearest,
                highlight: highlightOf(node.rect),
            });
        }
    }
    return out;
}

export const tokenUsage: Rule = {
    name: "token-usage",
    check(nodes, options) {
        const out: Violation[] = [];
        for (const node of nodes) out.push(...checkNode(node, options.tolerance));
        return out;
    },
};
