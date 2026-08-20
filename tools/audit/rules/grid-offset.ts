import {
    fillsRemainingFlexSpace,
    hasProportionalGridParent,
    isCentredByParent,
    isWrappingGroup,
} from "./shared.ts";
import type { Measured, Rule, Violation } from "./types.ts";

function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/** Nearest multiple of `unit` to `value`, for the violation's "expected" field. */
function nearestMultiple(value: number, unit: number): number {
    return Math.round(value / unit) * unit;
}

function offGrid(value: number, unit: number, tolerance: number): boolean {
    const remainder = ((value % unit) + unit) % unit;
    return remainder > tolerance && remainder < unit - tolerance;
}

/**
 * The nearest ancestor origin, starting from `node`'s parent rather than `node` itself: a node
 * that is itself declared as an origin (a nested panel, say) is positioned relative to whatever
 * origin contains it, not relative to its own box, which would always measure a zero-or-border
 * offset with nothing to do with where the browser actually placed it.
 */
function findOrigin(node: Element, origins: Measured[], root: Measured): Measured {
    let candidate: Element | null = node.parentElement;
    while (candidate !== null) {
        const found = origins.find((origin) => origin.node === candidate);
        if (found !== undefined) return found;
        candidate = candidate.parentElement;
    }
    return root;
}

/**
 * The origin's own border-box edges, per its own hairline border: an origin such as the panel
 * dividing a sidebar from the outlet carries a 1px border-inline-end, which offsets everything
 * measured against its bare getBoundingClientRect() by that same 1px, a false positive with
 * nothing to do with the 4px grid. The physical left edge is eaten into by border-inline-start
 * under LTR and by border-inline-end under RTL, since "inline-start" itself flips physical side
 * with the writing direction; reading both and picking the one that actually sits on the left
 * holds under either direction rather than assuming the physical side inline-start names.
 */
function contentOrigin(origin: Measured): { left: number; top: number } {
    const style = origin.style;
    const borderInlineStart = Number.parseFloat(style.borderInlineStartWidth) || 0;
    const borderInlineEnd = Number.parseFloat(style.borderInlineEndWidth) || 0;
    const borderBlockStart = Number.parseFloat(style.borderBlockStartWidth) || 0;
    const rtl = style.direction === "rtl";
    const leftBorder = rtl ? borderInlineEnd : borderInlineStart;
    return {
        left: origin.rect.left + leftBorder,
        top: origin.rect.top + borderBlockStart,
    };
}

/**
 * The 4px conformance check, measured relative to a declared origin rather than the viewport,
 * because a centred container in an odd-width viewport starts at a half pixel without anything
 * actually being misaligned.
 */
export const gridOffset: Rule = {
    name: "grid-offset",
    check(nodes, options) {
        const out: Violation[] = [];
        const unit = options.unit;
        const origins = nodes.filter((n) => n.node.hasAttribute("data-grid-origin"));
        const root = nodes[0];
        if (root === undefined) return out;

        for (const origin of origins) {
            const size = origin.rect.width;
            if (!Number.isInteger(size)) {
                out.push({
                    rule: "grid-offset",
                    severity: "error",
                    path: origin.path,
                    message: "grid origin's own inline size is not an even integer of pixels",
                    measured: size,
                    expected: Math.round(size),
                    highlight: highlightOf(origin.rect),
                });
            }
        }

        for (const node of nodes) {
            if (node === root) continue;
            // Terminal and code-editor surfaces are character-cell geometry, not grid geometry;
            // excluded here by ancestor rather than silently, matching the exemption ledger entry.
            if (node.node.closest("[data-audit-exempt-grid]") !== null) continue;
            const origin = findOrigin(node.node, origins, root);
            const originContent = contentOrigin(origin);

            // A direct child of a [data-audit-row] sits wherever the flex layout places it
            // relative to its siblings, and row-axis already asserts that row's own alignment
            // (a shared centre, a shared baseline, or a shared control height). When an earlier
            // sibling's own width is content-driven (a status chip sized to its label, for
            // instance), every following sibling's offset inherits that fractional geometry and
            // is never going to land on the 4px grid on its own; grid-offset here checks only
            // what a row does not, which is the row's own position and size against its origin.
            // A parent centring its children on either axis has the same effect even outside a
            // declared row: the centring itself, not a design defect, produces the fraction. A
            // descendant several levels under a row inherits the same fractional geometry (a
            // button nested inside a row's own flex group, for instance), so the check climbs
            // to the nearest row ancestor rather than only the direct parent.
            // A flex-wrap container (a row of independently-sized chips) lays each child at
            // whatever position the previous ones' content widths leave free; that position is
            // never going to land on the grid on its own and carries no design meaning to check.
            const underRow = node.node.closest("[data-audit-row]") !== null;
            const inWrappingGroup =
                node.node.parentElement !== null && isWrappingGroup(node.node.parentElement);
            const skipOffsets =
                underRow ||
                inWrappingGroup ||
                isCentredByParent(node.node) ||
                hasProportionalGridParent(node.node);

            if (!skipOffsets) {
                const inlineOffset = node.rect.left - originContent.left;
                if (offGrid(inlineOffset, unit, options.tolerance)) {
                    out.push({
                        rule: "grid-offset",
                        severity: "error",
                        path: node.path,
                        message: `inline-start offset from its grid origin is ${inlineOffset}px, not a multiple of ${unit}`,
                        measured: inlineOffset,
                        expected: nearestMultiple(inlineOffset, unit),
                        highlight: highlightOf(node.rect),
                    });
                }

                const blockOffset = node.rect.top - originContent.top;
                if (offGrid(blockOffset, unit, options.tolerance)) {
                    out.push({
                        rule: "grid-offset",
                        severity: "error",
                        path: node.path,
                        message: `block-start offset from its grid origin is ${blockOffset}px, not a multiple of ${unit}`,
                        measured: blockOffset,
                        expected: nearestMultiple(blockOffset, unit),
                        highlight: highlightOf(node.rect),
                    });
                }
            }

            if (!fillsRemainingFlexSpace(node.node) && offGrid(node.rect.height, unit, options.tolerance)) {
                out.push({
                    rule: "grid-offset",
                    severity: "error",
                    path: node.path,
                    message: `block size is ${node.rect.height}px, not a multiple of ${unit}`,
                    measured: node.rect.height,
                    expected: nearestMultiple(node.rect.height, unit),
                    highlight: highlightOf(node.rect),
                });
            }
        }
        return out;
    },
};
