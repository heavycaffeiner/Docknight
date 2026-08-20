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
 * Coarse-pointer floor: 48x48 with no clear-space branch, plus a minimum gap to the nearest
 * other target in the same scroll container, scaled by the smaller of the two targets.
 */
export const touchTarget: Rule = {
    name: "touch-target",
    check(nodes, options) {
        if (!options.coarsePointer) return [];
        const out: Violation[] = [];
        const targets = nodes.map((n) => n.node).filter((el) => el.matches(INTERACTIVE_SELECTOR));

        for (const node of nodes) {
            if (!node.node.matches(INTERACTIVE_SELECTOR)) continue;
            if (isInlineLinkInProse(node.node)) continue;
            if (isLabelledFormControl(node.node)) continue;
            const rect = activationRect(node.node);
            if (rect.width < 48 || rect.height < 48) {
                out.push({
                    rule: "touch-target",
                    severity: "error",
                    path: node.path,
                    message: `activation rect is ${rect.width}x${rect.height}px, requires 48x48 under a coarse pointer`,
                    measured: `${rect.width}x${rect.height}`,
                    expected: "48x48",
                    highlight: highlightOf(rect),
                });
                continue;
            }
            const neighbour = nearestNeighbour(node.node, targets);
            if (neighbour === null) continue;
            const neighbourRect = activationRect(neighbour.el);
            const smaller = Math.min(rect.width, rect.height, neighbourRect.width, neighbourRect.height);
            const minGap = smaller >= 48 ? 8 : 12;
            if (neighbour.gap < minGap) {
                out.push({
                    rule: "touch-target",
                    severity: "error",
                    path: node.path,
                    message: `gap to the nearest target is ${neighbour.gap}px, requires ${minGap}px`,
                    measured: neighbour.gap,
                    expected: minGap,
                    highlight: highlightOf(rect),
                });
            }
        }
        return out;
    },
};
