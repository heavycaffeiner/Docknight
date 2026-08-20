import { firstGlyphEdge, isCentredByParent, isHeading, isOwnColumnOrRow, isWrappingGroup, mode } from "./shared.ts";
import type { Measured, Rule, Violation } from "./types.ts";

function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function directChildren(column: Measured, all: Measured[]): Measured[] {
    return all.filter((n) => n.node.parentElement === column.node);
}

/**
 * Catches ink scattering across offsets while every box still shares a `column-edge`: a filled
 * control's glyph starts inside its own padding, which a box-edge comparison alone cannot see.
 */
export const glyphEdge: Rule = {
    name: "glyph-edge",
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
            const glyphs = children
                .map((child) => ({ child, edge: firstGlyphEdge(child.node) }))
                .filter((entry): entry is { child: Measured; edge: number } => entry.edge !== null);
            if (glyphs.length < 2) continue;

            const modal = mode(
                glyphs.map((g) => g.edge),
                options.tolerance,
            );
            if (modal === null) continue;

            for (const { child, edge } of glyphs) {
                if (Math.abs(edge - modal) > options.tolerance) {
                    out.push({
                        rule: "glyph-edge",
                        severity: "error",
                        path: child.path,
                        message: `first glyph starts at ${edge}px, column's modal glyph edge is ${modal}px`,
                        measured: edge,
                        expected: modal,
                        highlight: highlightOf(child.rect),
                    });
                }
            }
        }
        return out;
    },
};
