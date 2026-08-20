import stylelint from "stylelint";

const { createPlugin, utils } = stylelint;
const { report, ruleMessages, validateOptions } = utils;

const ruleName = "docknight/logical-properties";

const messages = ruleMessages(ruleName, {
    rejected: (prop, suggestion) => `${prop} is a physical property; use ${suggestion}`,
    rejectedTextAlign: () => `text-align: left/right is physical; use start or end`,
});

const BANNED = {
    "margin-left": "margin-inline-start",
    "margin-right": "margin-inline-end",
    "padding-left": "padding-inline-start",
    "padding-right": "padding-inline-end",
    "border-left": "border-inline-start",
    "border-right": "border-inline-end",
    "border-left-width": "border-inline-start-width",
    "border-right-width": "border-inline-end-width",
    "border-left-color": "border-inline-start-color",
    "border-right-color": "border-inline-end-color",
    "border-left-style": "border-inline-start-style",
    "border-right-style": "border-inline-end-style",
    "border-top-left-radius": "border-start-start-radius",
    "border-top-right-radius": "border-start-end-radius",
    "border-bottom-left-radius": "border-end-start-radius",
    "border-bottom-right-radius": "border-end-end-radius",
    left: "inset-inline-start",
    right: "inset-inline-end",
};

/** @type {import('stylelint').Rule} */
const rule = (primary) => {
    return (root, result) => {
        const validOptions = validateOptions(result, ruleName, { actual: primary, possible: [true, false] });
        if (!validOptions || primary === false) return;

        root.walkDecls((decl) => {
            const prop = decl.prop.toLowerCase();
            const suggestion = BANNED[prop];
            if (suggestion !== undefined) {
                report({ message: messages.rejected, messageArgs: [decl.prop, suggestion], node: decl, result, ruleName });
                return;
            }
            if (prop === "text-align" && (decl.value === "left" || decl.value === "right")) {
                report({ message: messages.rejectedTextAlign, node: decl, result, ruleName });
            }
        });
    };
};

rule.ruleName = ruleName;
rule.messages = messages;

export default createPlugin(ruleName, rule);
