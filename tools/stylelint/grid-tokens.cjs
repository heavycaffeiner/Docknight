"use strict";

const stylelint = require("stylelint");
const valueParser = require("postcss-value-parser");
const tokens = require("./tokens.json");
const allowedRaw = require("./allowed-raw.json");

const ruleName = "docknight/grid-tokens";

const messages = stylelint.utils.ruleMessages(ruleName, {
    rejected: (prop, value, nearest) =>
        nearest
            ? `Unexpected raw length "${value}" for "${prop}". Use var(${nearest}) or another token.`
            : `Unexpected value "${value}" for "${prop}". Only tokens, 0, 100%, auto, intrinsic sizes, fr units and calc() over tokens are allowed.`,
});

const SPATIAL = [
    /^margin(-.+)?$/,
    /^padding(-.+)?$/,
    /^gap$/,
    /^row-gap$/,
    /^column-gap$/,
    /^inset(-.+)?$/,
    /^(top|right|bottom|left)$/,
    /^(width|height)$/,
    /^(min|max)-(width|height|inline-size|block-size)$/,
    /^(inline|block)-size$/,
    /^border-radius$/,
    /^border-.+-radius$/,
    /^translate$/,
];

/** Border and outline widths are the hairline exception from proposal 6, section 4.3.1. */
const HAIRLINE = /^(border|outline)(-.*)?-?(width)?$/;

const KEYWORDS = new Set([
    "0",
    "auto",
    "100%",
    "none",
    "inherit",
    "initial",
    "unset",
    "revert",
    "min-content",
    "max-content",
    "fit-content",
    "stretch",
    "normal",
    "safe",
    "unsafe",
]);

const ALL_TOKENS = new Set([
    ...tokens.space,
    ...tokens.size,
    ...tokens.radius,
    ...tokens.measure,
    ...tokens.hairline,
    ...tokens.viewport,
]);

/** Arithmetic inside calc. Written as words by the value parser, not as operators. */
const OPERATORS = new Set(["+", "-", "*", "/"]);

/**
 * Viewport units are the third documented exception: they are produced by the browser rather than
 * authored, so a full-page container may claim the whole viewport.
 */
const VIEWPORT = /^100(vh|dvh|svh|lvh|vw|dvw|svw|lvw)$/;

const TOKEN_PIXELS = {
    "--space-1": 4,
    "--space-2": 8,
    "--space-3": 12,
    "--space-4": 16,
    "--space-5": 20,
    "--space-6": 24,
    "--space-8": 32,
    "--space-10": 40,
    "--space-12": 48,
    "--space-16": 64,
};

function isSpatial(prop) {
    const lower = prop.toLowerCase();
    if (HAIRLINE.test(lower) && !lower.includes("radius")) return false;
    return SPATIAL.some((re) => re.test(lower));
}

function nearestToken(value) {
    const px = Number.parseFloat(value);
    if (!Number.isFinite(px)) return null;
    let best = null;
    let bestDelta = Infinity;
    for (const [name, size] of Object.entries(TOKEN_PIXELS)) {
        const delta = Math.abs(size - px);
        if (delta < bestDelta) {
            bestDelta = delta;
            best = name;
        }
    }
    return best;
}

/** A var() reference is acceptable when its first argument names an approved token. */
function varIsToken(node) {
    const first = node.nodes.find((n) => n.type === "word");
    return Boolean(first && ALL_TOKENS.has(first.value));
}

function checkNode(node, insideCalc) {
    switch (node.type) {
        case "space":
        case "div":
            return true;
        case "word": {
            const lower = node.value.toLowerCase();
            if (KEYWORDS.has(lower)) return true;
            if (/^0(\.0+)?([a-z%]+)?$/.test(lower)) return true;
            if (/^[0-9.]+fr$/.test(lower)) return true;
            if (VIEWPORT.test(lower)) return true;
            // Percentages are legitimate inside a calc over a token, and 100% alone is allowed.
            if (insideCalc && /^[0-9.]+%$/.test(lower)) return true;
            // A bare number in calc can only be a factor or a divisor, so it keeps a token on grid.
            // Signed, because a pull-back is written as a negative factor over the inset it undoes.
            if (insideCalc && /^-?[0-9.]+$/.test(lower)) return true;
            if (insideCalc && OPERATORS.has(lower)) return true;
            return false;
        }
        case "function": {
            const name = node.value.toLowerCase();
            if (name === "var") return varIsToken(node);
            if (["calc", "min", "max", "clamp", "round"].includes(name)) {
                return node.nodes.every((child) => checkNode(child, true));
            }
            if (name === "env") return true;
            return false;
        }
        default:
            return false;
    }
}

/** @type {import('stylelint').Rule} */
const rule = (primary, _secondary, context) => (root, result) => {
    const valid = stylelint.utils.validateOptions(result, ruleName, {
        actual: primary,
        possible: [true],
    });
    if (!valid) return;

    const exempt = new Set(allowedRaw.declarations.map((d) => `${d.prop}:${d.value}`));

    root.walkDecls((decl) => {
        if (!isSpatial(decl.prop)) return;
        if (decl.value.includes("var(--_")) return; // component-private passthrough
        if (exempt.has(`${decl.prop}:${decl.value}`)) return;

        const parsed = valueParser(decl.value);
        const ok = parsed.nodes.every((node) => checkNode(node, false));
        if (ok) return;

        stylelint.utils.report({
            result,
            ruleName,
            message: messages.rejected(decl.prop, decl.value, nearestToken(decl.value)),
            node: decl,
            word: decl.value,
            context,
        });
    });
};

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = { url: "docs/proposals/docknight-8-design-verification.md" };

module.exports = stylelint.createPlugin(ruleName, rule);
