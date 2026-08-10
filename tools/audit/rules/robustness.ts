import type { Rule, Violation } from "./types.ts";
import { OVERLAY_SELECTOR, highlightOf, inFlowChildren } from "./shared.ts";

export const overflow: Rule = {
    name: "overflow",
    check(nodes) {
        const violations: Violation[] = [];
        const scroller = document.scrollingElement;
        if (scroller !== null && scroller.scrollWidth > window.innerWidth + 1) {
            violations.push({
                rule: "overflow",
                severity: "error",
                path: "document",
                message: "the document scrolls horizontally",
                measured: scroller.scrollWidth,
                expected: window.innerWidth,
                highlight: { x: 0, y: 0, width: window.innerWidth, height: 40 },
            });
        }

        for (const measured of nodes) {
            if (measured.node.hasAttribute("data-audit-clip")) continue;

            // Only a clipping box can lose content silently. A visible overflow is still on screen,
            // and what escapes the page entirely is caught by the document check above and by
            // in-viewport. An ellipsis is a declared truncation, and a visible one.
            const truncates = measured.style.textOverflow !== "clip";
            if (
                measured.style.overflowX === "hidden" &&
                !truncates &&
                measured.node.scrollWidth > measured.node.clientWidth + 1
            ) {
                violations.push({
                    rule: "overflow",
                    severity: "error",
                    path: measured.path,
                    message: "content is silently clipped on the inline axis",
                    measured: measured.node.scrollWidth,
                    expected: measured.node.clientWidth,
                    highlight: highlightOf(measured.rect),
                });
            }

            if (
                measured.style.overflowY === "hidden" &&
                measured.style.webkitLineClamp === "none" &&
                measured.node.scrollHeight > measured.node.clientHeight + 1
            ) {
                violations.push({
                    rule: "overflow",
                    severity: "error",
                    path: measured.path,
                    message: "text is silently clipped on the block axis",
                    measured: measured.node.scrollHeight,
                    expected: measured.node.clientHeight,
                    highlight: highlightOf(measured.rect),
                });
            }
        }
        return violations;
    },
};

/**
 * Children of a declared row or column must not overlap. Overlap is what a long translation or a
 * wide number produces when a layout was built with a fixed offset instead of flow, and it is
 * invisible to the grid rules because both boxes are individually on the grid.
 */
export const collision: Rule = {
    name: "collision",
    check(nodes, options) {
        const violations: Violation[] = [];
        const slack = options.tolerance;

        for (const measured of nodes) {
            const declared =
                measured.node.hasAttribute("data-audit-column") ||
                measured.node.hasAttribute("data-audit-row");
            if (!declared) continue;
            if (measured.node.closest(OVERLAY_SELECTOR) !== null) continue;
            const children = inFlowChildren(measured.node).filter((child) => {
                if (child.matches(OVERLAY_SELECTOR)) return false;
                const style = getComputedStyle(child);
                // A transform is how a deliberate overlap is expressed.
                if (style.transform !== "none") return false;
                const rect = child.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
            if (children.length < 2) continue;

            const rects = children.map((child) => child.getBoundingClientRect());
            for (let a = 0; a < rects.length; a += 1) {
                for (let b = a + 1; b < rects.length; b += 1) {
                    const first = rects[a] as DOMRect;
                    const second = rects[b] as DOMRect;
                    const inline =
                        Math.min(first.right, second.right) - Math.max(first.left, second.left);
                    const block =
                        Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
                    if (inline <= slack || block <= slack) continue;
                    violations.push({
                        rule: "collision",
                        severity: "error",
                        path: `${measured.path} > ${a} and ${b}`,
                        message: `siblings overlap by ${inline.toFixed(2)}px by ${block.toFixed(2)}px`,
                        measured: `${inline.toFixed(2)}x${block.toFixed(2)}`,
                        expected: "no overlap",
                        highlight: {
                            x: Math.max(first.left, second.left),
                            y: Math.max(first.top, second.top),
                            width: inline,
                            height: block,
                        },
                    });
                }
            }
        }
        return violations;
    },
};

export const inViewport: Rule = {
    name: "in-viewport",
    check(nodes) {
        const violations: Violation[] = [];
        for (const measured of nodes) {
            if (measured.style.position === "fixed") continue;
            if (measured.rect.width === 0) continue;
            if (measured.rect.left < -1 || measured.rect.right > window.innerWidth + 1) {
                violations.push({
                    rule: "in-viewport",
                    severity: "error",
                    path: measured.path,
                    message: "element extends outside the viewport on the inline axis",
                    measured: `${measured.rect.left.toFixed(0)}..${measured.rect.right.toFixed(0)}`,
                    expected: `0..${window.innerWidth}`,
                    highlight: highlightOf(measured.rect),
                });
            }
        }
        return violations;
    },
};
