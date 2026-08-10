import type { Rule, Violation } from "./types.ts";
import {
    composite,
    contrastRatio,
    effectiveBackground,
    highlightOf,
    ownText,
    parseColour,
} from "./shared.ts";

/** WCAG 1.4.3: 24px, or 18.66px when bold, is large text and carries the lower threshold. */
function threshold(style: CSSStyleDeclaration): number {
    const size = Number.parseFloat(style.fontSize);
    const weight = Number.parseInt(style.fontWeight, 10);
    const bold = Number.isNaN(weight) ? style.fontWeight === "bold" : weight >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    return large ? 3 : 4.5;
}

/** Screen-reader-only text is not painted, so its contrast is not a question. */
function visuallyHidden(style: CSSStyleDeclaration, rect: DOMRect): boolean {
    if (rect.width <= 1 || rect.height <= 1) return true;
    if (style.clipPath.includes("inset(50%")) return true;
    return Number(style.opacity) === 0;
}

/** WCAG 1.4.11: a boundary that carries meaning needs 3:1 against what is next to it. */
const BOUNDARY_RATIO = 3;

/** An inactive control is exempt from both contrast thresholds, and its dimming is the point. */
function inactive(node: Element): boolean {
    return node.closest("[disabled], [aria-disabled='true']") !== null;
}

/** Computed box-shadow puts the colour first, so the leading rgb() or rgba() is the shadow's. */
function shadowColour(shadow: string): string | null {
    if (!shadow.includes("inset")) return null;
    const match = /rgba?\([^)]*\)/.exec(shadow);
    return match === null ? null : match[0];
}

function boundaryColour(style: CSSStyleDeclaration): string | null {
    if (Number.parseFloat(style.borderTopWidth) > 0) return style.borderTopColor;
    // A hairline drawn as an inset shadow costs no layout, which is why the project draws its
    // boundaries that way. It still has to be visible.
    const shadow = shadowColour(style.boxShadow);
    if (shadow !== null) return shadow;
    if (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) {
        return style.outlineColor;
    }
    return null;
}

export const contrast: Rule = {
    name: "contrast",
    check(nodes) {
        const violations: Violation[] = [];
        for (const measured of nodes) {
            if (inactive(measured.node)) continue;

            if (measured.node.hasAttribute("data-audit-boundary")) {
                const raw = boundaryColour(measured.style);
                const behind = effectiveBackground(measured.node.parentElement ?? measured.node);
                const edge = raw === null ? null : parseColour(raw);
                if (edge !== null && behind !== null) {
                    const ratio = contrastRatio(composite(edge, behind), behind);
                    if (ratio < BOUNDARY_RATIO) {
                        violations.push({
                            rule: "contrast",
                            severity: "error",
                            path: measured.path,
                            message: `boundary contrast ${ratio.toFixed(2)}:1 is below ${BOUNDARY_RATIO}:1`,
                            measured: Number(ratio.toFixed(2)),
                            expected: BOUNDARY_RATIO,
                            highlight: highlightOf(measured.rect),
                        });
                    }
                }
            }

            if (ownText(measured.node) === "") continue;
            if (visuallyHidden(measured.style, measured.rect)) continue;

            const foreground = parseColour(measured.style.color);
            const background = effectiveBackground(measured.node);
            if (foreground === null || background === null) {
                violations.push({
                    rule: "contrast-unknown",
                    severity: "warning",
                    path: measured.path,
                    message:
                        "contrast could not be computed: no opaque background, or a background image",
                    measured: measured.style.color,
                    expected: "a resolvable opaque background",
                    highlight: highlightOf(measured.rect),
                });
                continue;
            }

            const painted = composite(foreground, background);
            const ratio = contrastRatio(painted, background);
            const required = threshold(measured.style);
            if (ratio >= required) continue;
            violations.push({
                rule: "contrast",
                severity: "error",
                path: measured.path,
                message: `text contrast ${ratio.toFixed(2)}:1 is below ${required}:1`,
                measured: Number(ratio.toFixed(2)),
                expected: required,
                highlight: highlightOf(measured.rect),
            });
        }
        return violations;
    },
};
