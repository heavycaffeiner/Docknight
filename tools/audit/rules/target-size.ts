import { activationRect, INTERACTIVE_SELECTOR, isLabelledFormControl, nearestNeighbour } from "./shared.ts";
import type { Rule, Violation } from "./types.ts";

function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function isInlineLinkInProse(el: Element): boolean {
    if (el.tagName !== "A") return false;
    const parent = el.parentElement;
    return parent !== null && /^(P|LI|TD|TH|DD|BLOCKQUOTE)$/.test(parent.tagName);
}

/**
 * Fine-pointer floor (WCAG 2.5.8): 48x48, or 32x32 with at least 8px of clear space to the
 * nearest other interactive target. Runs only on cells emulating a fine pointer; the coarse
 * equivalent with no clear-space branch is `touch-target`.
 */
export const targetSize: Rule = {
    name: "target-size",
    check(nodes, options) {
        if (options.coarsePointer) return [];
        const out: Violation[] = [];
        const targets = nodes.map((n) => n.node).filter((el) => el.matches(INTERACTIVE_SELECTOR));

        for (const node of nodes) {
            if (!node.node.matches(INTERACTIVE_SELECTOR)) continue;
            if (isInlineLinkInProse(node.node)) continue;
            if (isLabelledFormControl(node.node)) continue;
            const rect = activationRect(node.node);
            if (rect.width >= 48 && rect.height >= 48) continue;
            if (rect.width >= 32 && rect.height >= 32) {
                const neighbour = nearestNeighbour(node.node, targets);
                if (neighbour !== null && neighbour.gap >= 8) continue;
            }
            out.push({
                rule: "target-size",
                severity: "error",
                path: node.path,
                message: `activation rect is ${rect.width}x${rect.height}px, requires 48x48 or 32x32 with 8px clear space`,
                measured: `${rect.width}x${rect.height}`,
                expected: "48x48",
                highlight: highlightOf(rect),
            });
        }
        return out;
    },
};
