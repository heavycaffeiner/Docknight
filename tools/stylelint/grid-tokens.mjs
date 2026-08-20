import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import valueParser from "postcss-value-parser";
import stylelint from "stylelint";

const { createPlugin, utils } = stylelint;
const { report, ruleMessages, validateOptions } = utils;

const ruleName = "docknight/grid-tokens";

const messages = ruleMessages(ruleName, {
    rejected: (prop, value, nearest) => `${prop}: "${value}" is not a spacing token (nearest: ${nearest})`,
});

const tokensPath = fileURLToPath(new URL("./tokens.json", import.meta.url));
const allowedRawPath = fileURLToPath(new URL("./allowed-raw.json", import.meta.url));
const tokens = JSON.parse(readFileSync(tokensPath, "utf8"));
const approvedTokens = new Set([...tokens.space, ...tokens.size, ...tokens.radius, ...tokens.other]);
const allowedRaw = new Set(JSON.parse(readFileSync(allowedRawPath, "utf8")));

const TOKEN_PX_VALUES = {
    "--space-1": 4, "--space-2": 8, "--space-3": 12, "--space-4": 16, "--space-5": 20,
    "--space-6": 24, "--space-8": 32, "--space-10": 40, "--space-12": 48, "--space-16": 64,
    "--size-control-sm": 32, "--size-control-md": 40, "--size-control-lg": 48, "--size-control-xl": 56,
    "--size-icon-sm": 16, "--size-icon-md": 20, "--size-icon-lg": 24,
    "--radius-xs": 4, "--radius-sm": 8, "--radius-md": 12, "--radius-lg": 16, "--radius-xl": 28,
};

const SPATIAL_PROP_RE =
    /^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left|width|height|min-width|max-width|min-height|max-height|border-radius|translate)(-.*)?$/;

const BORDER_WIDTH_RE = /^(border(-\w+)?-width|outline-width)$/;

const KEYWORD_VALUES = new Set(["0", "auto", "100%", "min-content", "max-content", "fit-content", "none"]);

function nearestToken(px) {
    let best = null;
    let bestDelta = Infinity;
    for (const [name, value] of Object.entries(TOKEN_PX_VALUES)) {
        const delta = Math.abs(value - px);
        if (delta < bestDelta) {
            bestDelta = delta;
            best = name;
        }
    }
    return best ?? "a spacing token";
}

/**
 * Every value node under a spatial property must resolve to an approved token, a permitted
 * keyword, an flex value, or a calc() built only from those. Raw px is allowed only on border
 * and outline widths, which are hairlines rather than grid geometry.
 */
function isAcceptedNode(node) {
    if (node.type === "word") {
        const value = node.value;
        if (KEYWORD_VALUES.has(value)) return true;
        if (/^-?\d+(\.\d+)?fr$/.test(value)) return true;
        if (allowedRaw.has(value)) return true;
        return false;
    }
    if (node.type === "function" && node.value === "var") {
        const first = node.nodes.find((n) => n.type === "word");
        return first !== undefined && approvedTokens.has(first.value);
    }
    if (node.type === "function" && node.value === "calc") {
        // postcss-value-parser tokenises the arithmetic operators as plain words (+, -, *, /),
        // not as a distinct operator type; every other node must still resolve to an accepted
        // length so a raw px operand inside calc() is still caught. A unitless number (-1, 2,
        // 0.5) is a scalar multiplier or divisor, not a length, so it is accepted only here,
        // inside calc(); it would be invalid CSS on a spatial property by itself.
        return node.nodes.every((n) => {
            if (n.type === "space") return true;
            if (n.type === "word" && (n.value === "+" || n.value === "-" || n.value === "*" || n.value === "/")) {
                return true;
            }
            if (n.type === "word" && /^-?\d+(\.\d+)?$/.test(n.value)) return true;
            return isAcceptedNode(n);
        });
    }
    return false;
}

/** @type {import('stylelint').Rule} */
const rule = (primary) => {
    return (root, result) => {
        const validOptions = validateOptions(result, ruleName, { actual: primary, possible: [true, false] });
        if (!validOptions || primary === false) return;

        root.walkDecls((decl) => {
            const prop = decl.prop.toLowerCase();
            if (!SPATIAL_PROP_RE.test(prop)) return;

            const parsed = valueParser(decl.value);
            for (const node of parsed.nodes) {
                if (node.type === "space" || node.type === "div") continue;
                if (BORDER_WIDTH_RE.test(prop) && node.type === "word" && /^\d+(\.\d+)?px$/.test(node.value)) {
                    continue;
                }
                if (isAcceptedNode(node)) continue;

                const raw = valueParser.stringify(node);
                const pxMatch = /^(-?\d+(?:\.\d+)?)px$/.exec(raw);
                const nearest = pxMatch !== null ? nearestToken(Number(pxMatch[1])) : "a spacing token";
                report({
                    message: messages.rejected,
                    messageArgs: [decl.prop, raw, nearest],
                    node: decl,
                    result,
                    ruleName,
                });
            }
        });
    };
};

rule.ruleName = ruleName;
rule.messages = messages;

export default createPlugin(ruleName, rule);
