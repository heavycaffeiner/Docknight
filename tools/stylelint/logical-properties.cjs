"use strict";

const stylelint = require("stylelint");

const ruleName = "docknight/logical-properties";

const messages = stylelint.utils.ruleMessages(ruleName, {
    property: (prop, replacement) =>
        `Unexpected physical property "${prop}". Use "${replacement}" so right-to-left mirroring stays automatic.`,
    value: (prop, value, replacement) =>
        `Unexpected physical value "${value}" for "${prop}". Use "${replacement}".`,
});

const PROPERTY_REPLACEMENTS = {
    "margin-left": "margin-inline-start",
    "margin-right": "margin-inline-end",
    "margin-top": "margin-block-start",
    "margin-bottom": "margin-block-end",
    "padding-left": "padding-inline-start",
    "padding-right": "padding-inline-end",
    "padding-top": "padding-block-start",
    "padding-bottom": "padding-block-end",
    "border-left": "border-inline-start",
    "border-right": "border-inline-end",
    "border-top": "border-block-start",
    "border-bottom": "border-block-end",
    "border-left-width": "border-inline-start-width",
    "border-right-width": "border-inline-end-width",
    "border-top-width": "border-block-start-width",
    "border-bottom-width": "border-block-end-width",
    "border-left-color": "border-inline-start-color",
    "border-right-color": "border-inline-end-color",
    "border-top-color": "border-block-start-color",
    "border-bottom-color": "border-block-end-color",
    "border-left-style": "border-inline-start-style",
    "border-right-style": "border-inline-end-style",
    "border-top-style": "border-block-start-style",
    "border-bottom-style": "border-block-end-style",
    "border-top-left-radius": "border-start-start-radius",
    "border-top-right-radius": "border-start-end-radius",
    "border-bottom-left-radius": "border-end-start-radius",
    "border-bottom-right-radius": "border-end-end-radius",
    left: "inset-inline-start",
    right: "inset-inline-end",
    top: "inset-block-start",
    bottom: "inset-block-end",
    width: "inline-size",
    height: "block-size",
    "min-width": "min-inline-size",
    "min-height": "min-block-size",
    "max-width": "max-inline-size",
    "max-height": "max-block-size",
    "overflow-x": "overflow-inline",
    "overflow-y": "overflow-block",
};

/** width and height read naturally and are not mirrored, so they stay permitted. */
const TOLERATED = new Set([
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "overflow-x",
    "overflow-y",
]);

const VALUE_REPLACEMENTS = {
    "text-align": { left: "start", right: "end" },
    float: { left: "inline-start", right: "inline-end" },
    clear: { left: "inline-start", right: "inline-end" },
    "resize": {},
};

/** @type {import('stylelint').Rule} */
const rule = (primary, _secondary, context) => (root, result) => {
    const valid = stylelint.utils.validateOptions(result, ruleName, {
        actual: primary,
        possible: [true],
    });
    if (!valid) return;

    root.walkDecls((decl) => {
        const prop = decl.prop.toLowerCase();
        const replacement = PROPERTY_REPLACEMENTS[prop];
        if (replacement && !TOLERATED.has(prop)) {
            stylelint.utils.report({
                result,
                ruleName,
                message: messages.property(decl.prop, replacement),
                node: decl,
                word: decl.prop,
                context,
            });
            return;
        }

        const valueMap = VALUE_REPLACEMENTS[prop];
        if (!valueMap) return;
        const value = decl.value.trim().toLowerCase();
        const valueReplacement = valueMap[value];
        if (!valueReplacement) return;

        stylelint.utils.report({
            result,
            ruleName,
            message: messages.value(decl.prop, decl.value, valueReplacement),
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
