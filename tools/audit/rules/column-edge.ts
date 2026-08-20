import { isCentredByParent, isHeading, isOwnColumnOrRow, isWrappingGroup, mode } from "./shared.ts";
import type { Measured, Rule, Violation } from "./types.ts";

function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function directChildren(column: Measured, all: Measured[]): Measured[] {
    return all.filter((n) => n.node.parentElement === column.node);
}

/** Every direct in-flow child of a [data-audit-column] shares one inline-start box edge. */
export const columnEdge: Rule = {
    name: "column-edge",
    check(nodes, options) {
        const out: Violation[] = [];
        const columns = nodes.filter((n) => n.node.hasAttribute("data-audit-column"));

        for (const column of columns) {
            const children = directChildren(column, nodes).filter(
                (child) =>
                    !isHeading(child.node) &&
                    !isWrappingGroup(child.node) &&
                    !isOwnColumnOrRow(child.node) &&
                    !isCentredByParent(child.node),
            );
            const edges = children.map((c) => c.rect.left);
            const modal = mode(edges, options.tolerance);
            if (modal === null) continue;

            for (const child of children) {
                if (Math.abs(child.rect.left - modal) > options.tolerance) {
                    out.push({
                        rule: "column-edge",
                        severity: "error",
                        path: child.path,
                        message: `inline-start edge is ${child.rect.left}px, column's modal edge is ${modal}px`,
                        measured: child.rect.left,
                        expected: modal,
                        highlight: highlightOf(child.rect),
                    });
                }
            }
        }
        return out;
    },
};
