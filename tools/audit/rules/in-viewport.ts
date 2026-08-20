import type { Rule, Violation } from "./types.ts";

function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/** No measured element starts before the inline-start edge or ends past the viewport width. */
export const inViewport: Rule = {
    name: "in-viewport",
    check(nodes) {
        const out: Violation[] = [];
        const width = window.innerWidth;
        for (const node of nodes) {
            if (node.rect.width === 0 && node.rect.height === 0) continue;
            if (node.rect.left < -0.5) {
                out.push({
                    rule: "in-viewport",
                    severity: "error",
                    path: node.path,
                    message: `left edge is ${node.rect.left}px, before the viewport`,
                    measured: node.rect.left,
                    expected: 0,
                    highlight: highlightOf(node.rect),
                });
            }
            if (node.rect.right > width + 0.5) {
                out.push({
                    rule: "in-viewport",
                    severity: "error",
                    path: node.path,
                    message: `right edge is ${node.rect.right}px, past the viewport width ${width}px`,
                    measured: node.rect.right,
                    expected: width,
                    highlight: highlightOf(node.rect),
                });
            }
        }
        return out;
    },
};
