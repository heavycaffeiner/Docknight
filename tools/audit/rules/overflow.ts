import type { Rule, Violation } from "./types.ts";

function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * Three conditions: horizontal document overflow (the only one asserted at the `reflow`
 * geometry), element overflow with no declared clip, and unintended vertical clipping.
 */
export const overflow: Rule = {
    name: "overflow",
    check(nodes) {
        const out: Violation[] = [];
        const scrollingElement = document.scrollingElement;
        if (scrollingElement !== null && scrollingElement.scrollWidth > window.innerWidth + 1) {
            out.push({
                rule: "overflow",
                severity: "error",
                path: "document",
                message: `document scrollWidth ${scrollingElement.scrollWidth}px exceeds the viewport width ${window.innerWidth}px`,
                measured: scrollingElement.scrollWidth,
                expected: window.innerWidth,
                highlight: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
            });
        }

        for (const node of nodes) {
            const el = node.node;
            if (el === document.body || el === document.documentElement) continue;
            if (el.hasAttribute("data-audit-clip")) continue;

            const overflowX = node.style.overflowX;
            if (
                (overflowX === "visible" || overflowX === "hidden") &&
                el.scrollWidth > el.clientWidth + 1
            ) {
                out.push({
                    rule: "overflow",
                    severity: "error",
                    path: node.path,
                    message: `scrollWidth ${el.scrollWidth}px exceeds clientWidth ${el.clientWidth}px with overflow-x: ${overflowX}`,
                    measured: el.scrollWidth,
                    expected: el.clientWidth,
                    highlight: highlightOf(node.rect),
                });
            }

            const overflowY = node.style.overflowY;
            const clamped = node.style.getPropertyValue("-webkit-line-clamp") !== "";
            if (overflowY === "hidden" && !clamped && el.scrollHeight > el.clientHeight + 1) {
                out.push({
                    rule: "overflow",
                    severity: "error",
                    path: node.path,
                    message: `scrollHeight ${el.scrollHeight}px exceeds clientHeight ${el.clientHeight}px with overflow-y: hidden and no line-clamp`,
                    measured: el.scrollHeight,
                    expected: el.clientHeight,
                    highlight: highlightOf(node.rect),
                });
            }
        }
        return out;
    },
};
