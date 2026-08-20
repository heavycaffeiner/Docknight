import type { Measured, Rule, Violation } from "./types.ts";

function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function nearestColumn(node: Element): Element | null {
    return node.closest("[data-audit-column]");
}

/**
 * A numeric cell's position among its own siblings that are also numeric cells: two cells at
 * index 0 of two different repeated rows are the same table column and belong in one group; a
 * CPU cell and a memory cell sharing one row are index 0 and index 1, different columns, and
 * must not be averaged together just because they share a [data-audit-column] ancestor.
 */
function siblingNumericIndex(node: Element): number {
    const parent = node.parentElement;
    if (parent === null) return 0;
    let index = 0;
    for (const sibling of parent.children) {
        if (sibling === node) return index;
        if (sibling.hasAttribute("data-audit-numeric")) index += 1;
    }
    return index;
}

/** Every [data-audit-numeric] cell uses tabular figures, and cells at one table position share an edge. */
export const numericAlignment: Rule = {
    name: "numeric-alignment",
    check(nodes, options) {
        const out: Violation[] = [];
        const cells = nodes.filter((n) => n.node.hasAttribute("data-audit-numeric"));

        for (const cell of cells) {
            if (!cell.style.fontVariantNumeric.includes("tabular-nums")) {
                out.push({
                    rule: "numeric-alignment",
                    severity: "error",
                    path: cell.path,
                    message: "numeric cell does not use tabular-nums",
                    measured: cell.style.fontVariantNumeric || "normal",
                    expected: "tabular-nums",
                    highlight: highlightOf(cell.rect),
                });
            }
        }

        const byColumn = new Map<Element, Map<number, Measured[]>>();
        for (const cell of cells) {
            const column = nearestColumn(cell.node);
            if (column === null) continue;
            const byIndex = byColumn.get(column) ?? new Map<number, Measured[]>();
            byColumn.set(column, byIndex);
            const index = siblingNumericIndex(cell.node);
            const list = byIndex.get(index) ?? [];
            list.push(cell);
            byIndex.set(index, list);
        }

        for (const byIndex of byColumn.values()) {
            for (const cellsInGroup of byIndex.values()) {
                if (cellsInGroup.length < 2) continue;
                const edges = cellsInGroup.map((c) => c.rect.right);
                const modal = edges.reduce((a, b) => a + b, 0) / edges.length;
                for (const cell of cellsInGroup) {
                    if (Math.abs(cell.rect.right - modal) > options.tolerance) {
                        out.push({
                            rule: "numeric-alignment",
                            severity: "error",
                            path: cell.path,
                            message: `inline-end edge is ${cell.rect.right}px, column's average edge is ${modal}px`,
                            measured: cell.rect.right,
                            expected: modal,
                            highlight: highlightOf(cell.rect),
                        });
                    }
                }
            }
        }
        return out;
    },
};
