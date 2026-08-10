import type { Rule, Violation } from "./types.ts";
import {
    INTERACTIVE_SELECTOR,
    composite,
    contrastRatio,
    effectiveBackground,
    highlightOf,
    parseColour,
} from "./shared.ts";

const INDICATOR_RATIO = 3;

interface Indicator {
    outline: string;
    boxShadow: string;
    backgroundColor: string;
    border: string;
}

function indicatorOf(style: CSSStyleDeclaration): Indicator {
    return {
        outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
        boxShadow: style.boxShadow,
        backgroundColor: style.backgroundColor,
        border: `${style.borderColor} ${style.borderWidth}`,
    };
}

function differs(before: Indicator, after: Indicator): boolean {
    return (
        before.outline !== after.outline ||
        before.boxShadow !== after.boxShadow ||
        before.backgroundColor !== after.backgroundColor ||
        before.border !== after.border
    );
}

/** How far up an indicator drawn by a wrapper is still this control's indicator. */
const WRAPPER_DEPTH = 3;

/**
 * The control, its siblings, and the few wrappers around it. A text field leaves the input itself
 * unstyled and draws its ring on a layer element beside it, so reading the input alone, or even the
 * input and its ancestors, reports a styled control as bare.
 */
function indicatorChain(node: Element): Element[] {
    const chain: Element[] = [node];
    let current = node.parentElement;
    if (current !== null) {
        for (const sibling of current.children) {
            if (sibling !== node) chain.push(sibling);
        }
    }
    for (let depth = 0; depth < WRAPPER_DEPTH && current !== null; depth += 1) {
        chain.push(current);
        current = current.parentElement;
    }
    return chain;
}

/**
 * Whether any loaded rule targets this element with :focus-visible. Chromium applies
 * :focus-visible to a scripted focus only once the document has seen keyboard input, so the
 * computed-style comparison alone would report a styled element as unstyled; this answers the same
 * question from the stylesheet side. The runner presses Tab before auditing to make the first path
 * work, and this is the fallback when it does not.
 */
function hasFocusVisibleRule(node: Element): boolean {
    for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }
        for (const rule of rules) {
            if (!(rule instanceof CSSStyleRule)) continue;
            if (!rule.selectorText.includes(":focus-visible")) continue;
            for (const part of rule.selectorText.split(",")) {
                if (!part.includes(":focus-visible")) continue;
                const stripped = part.replaceAll(":focus-visible", "").trim();
                if (stripped === "") continue;
                try {
                    if (node.matches(stripped) || node.closest(stripped) !== null) return true;
                } catch {
                    continue;
                }
            }
        }
    }
    return false;
}

/**
 * Every operable element must show a focus indicator, and an outline must stand out from what is
 * behind it. This rule focuses elements, so it runs after every measuring rule and puts focus back
 * where it found it.
 */
export const focusVisible: Rule = {
    name: "focus-visible",
    mutates: true,
    check(nodes) {
        const violations: Violation[] = [];
        const previous = document.activeElement;

        for (const measured of nodes) {
            const node = measured.node;
            if (!node.matches(INTERACTIVE_SELECTOR)) continue;
            if (measured.rect.width <= 1 || measured.rect.height <= 1) continue;
            if (!(node instanceof HTMLElement)) continue;
            if (node.hasAttribute("disabled")) continue;

            const chain = indicatorChain(node);
            const before = chain.map((element) => indicatorOf(getComputedStyle(element)));
            node.focus({ preventScroll: true });
            if (document.activeElement !== node) continue;
            const focused = getComputedStyle(node);
            const after = chain.map((element) => indicatorOf(getComputedStyle(element)));
            const outlineStyle = focused.outlineStyle;
            const outlineWidth = Number.parseFloat(focused.outlineWidth);
            const outlineColour = parseColour(focused.outlineColor);
            // A positive offset paints the ring outside the border box, so what it has to stand out
            // from is whatever the control sits on, not the control's own fill.
            const outlineOffset = Number.parseFloat(focused.outlineOffset);
            const behind = effectiveBackground(
                outlineOffset > 0 ? (node.parentElement ?? node) : node,
            );
            node.blur();

            if (outlineStyle !== "none" && outlineWidth > 0) {
                if (outlineColour === null || behind === null) continue;
                const ratio = contrastRatio(composite(outlineColour, behind), behind);
                if (ratio >= INDICATOR_RATIO) continue;
                violations.push({
                    rule: "focus-visible",
                    severity: "error",
                    path: measured.path,
                    message: `focus outline contrast ${ratio.toFixed(2)}:1 is below ${INDICATOR_RATIO}:1`,
                    measured: Number(ratio.toFixed(2)),
                    expected: INDICATOR_RATIO,
                    highlight: highlightOf(measured.rect),
                });
                continue;
            }

            // No outline. A ring drawn with box-shadow or a colour change is still an indicator.
            if (before.some((entry, index) => differs(entry, after[index] as Indicator))) continue;
            if (hasFocusVisibleRule(node)) continue;

            violations.push({
                rule: "focus-visible",
                severity: "error",
                path: measured.path,
                message: "focusing this element changes nothing visible",
                measured: (before[0] as Indicator).outline,
                expected: "a visible focus indicator",
                highlight: highlightOf(measured.rect),
            });
        }

        if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
        return violations;
    },
};
