import type { Measured, Rule, Violation } from "./types.ts";

function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function isExcluded(node: Measured): boolean {
    if (node.style.position === "absolute" || node.style.position === "fixed") return true;
    if (node.style.transform !== "none") return true;
    if (node.node.closest("[popover], dialog, [data-audit-volatile]") !== null) return true;
    return false;
}

function intersects(a: DOMRect, b: DOMRect): boolean {
    const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return overlapX > 0.5 && overlapY > 0.5;
}

function directChildren(container: Measured, all: Measured[]): Measured[] {
    return all.filter((n) => n.node.parentElement === container.node && !isExcluded(n));
}

/** No two in-flow siblings of a [data-audit-column] or [data-audit-row] overlap on both axes. */
export const collision: Rule = {
    name: "collision",
    check(nodes) {
        const out: Violation[] = [];
        const containers = nodes.filter(
            (n) => n.node.hasAttribute("data-audit-column") || n.node.hasAttribute("data-audit-row"),
        );

        for (const container of containers) {
            const children = directChildren(container, nodes);
            for (let i = 0; i < children.length; i += 1) {
                for (let j = i + 1; j < children.length; j += 1) {
                    const a = children[i] as Measured;
                    const b = children[j] as Measured;
                    if (intersects(a.rect, b.rect)) {
                        out.push({
                            rule: "collision",
                            severity: "error",
                            path: `${a.path} + ${b.path}`,
                            message: "two in-flow siblings overlap on both axes",
                            measured: `${a.path} x ${b.path}`,
                            expected: "no overlap",
                            highlight: highlightOf(a.rect),
                        });
                    }
                }
            }
        }
        return out;
    },
};
