import type { Measured, Rule, Violation } from "./types.ts";
import {
    centreOf,
    declaredFromOrigin,
    firstBaseline,
    hairlineSize,
    highlightOf,
    inFlowChildren,
    nearestMultiple,
    offGrid,
    originFor,
} from "./shared.ts";

/**
 * Conformance is measured relative to a declared origin, because a centred container in an
 * odd-width viewport starts at a half pixel and every child inherits that offset without anything
 * being misaligned.
 */
export const gridOffset: Rule = {
    name: "grid-offset",
    check(nodes, options) {
        const violations: Violation[] = [];
        for (const measured of nodes) {
            const origin = originFor(measured.node, nodes);
            if (origin === null) continue;

            const declared = declaredFromOrigin(measured.node, origin.node);
            const inlineStart = measured.rect.left - origin.rect.left;
            const blockStart = measured.rect.top - origin.rect.top;

            for (const [edge, offset, stated] of [
                ["inlineStart", inlineStart, declared.inline],
                ["blockStart", blockStart, declared.block],
            ] as const) {
                if (!stated) continue;
                if (!offGrid(offset, options.unit, options.tolerance)) continue;
                violations.push({
                    rule: "grid-offset",
                    severity: "error",
                    path: measured.path,
                    message: `${edge} offset ${offset.toFixed(2)}px from the grid origin`,
                    measured: Number(offset.toFixed(2)),
                    expected: nearestMultiple(offset, options.unit),
                    highlight: highlightOf(measured.rect),
                });
            }

            // Inline extents are not checked: a content-driven width is legitimately fractional.
            // A non-replaced inline box has no block extent of its own either; what it reports is
            // the font's content area.
            const height = measured.rect.height;
            const rule = Math.abs(height - hairlineSize()) <= options.tolerance;
            if (
                measured.style.display !== "inline" &&
                !rule &&
                offGrid(height, options.unit, options.tolerance)
            ) {
                violations.push({
                    rule: "grid-offset",
                    severity: "error",
                    path: measured.path,
                    message: `block size ${height.toFixed(2)}px is off the grid`,
                    measured: Number(height.toFixed(2)),
                    expected: nearestMultiple(height, options.unit),
                    highlight: highlightOf(measured.rect),
                });
            }
        }
        return violations;
    },
};

/**
 * An origin whose own width is odd puts every centred descendant on a half pixel, which the offset
 * rule above then cannot see. Checking the origin itself is what makes that failure visible.
 */
export const originWidth: Rule = {
    name: "origin-width",
    check(nodes, options) {
        const violations: Violation[] = [];
        for (const measured of nodes) {
            if (!measured.node.hasAttribute("data-grid-origin")) continue;
            const width = measured.rect.width;
            if (Math.abs(width % 2) <= options.tolerance) continue;
            if (Math.abs(width % 2) >= 2 - options.tolerance) continue;
            violations.push({
                rule: "origin-width",
                severity: "warning",
                path: measured.path,
                message: `grid origin width ${width.toFixed(2)}px is odd, so centred children land on half pixels`,
                measured: Number(width.toFixed(2)),
                expected: Math.round(width / 2) * 2,
                highlight: highlightOf(measured.rect),
            });
        }
        return violations;
    },
};

/**
 * Group boxes into the runs that overlap on one axis. A container declared as a column becomes a row
 * at a narrow width, and a container declared as a row wraps onto several lines; in both cases the
 * declared alignment holds inside each run and comparing across runs measures the reflow instead.
 */
function overlapping<T extends { rect: DOMRect }>(items: T[], axis: "inline" | "block"): T[][] {
    const start = (rect: DOMRect) => (axis === "inline" ? rect.left : rect.top);
    const end = (rect: DOMRect) => (axis === "inline" ? rect.right : rect.bottom);
    const buckets: { start: number; end: number; members: T[] }[] = [];

    for (const item of [...items].sort((a, b) => start(a.rect) - start(b.rect))) {
        const bucket = buckets.find(
            (candidate) => start(item.rect) < candidate.end && end(item.rect) > candidate.start,
        );
        if (bucket === undefined) {
            buckets.push({ start: start(item.rect), end: end(item.rect), members: [item] });
            continue;
        }
        bucket.start = Math.min(bucket.start, start(item.rect));
        bucket.end = Math.max(bucket.end, end(item.rect));
        bucket.members.push(item);
    }

    return buckets.map((bucket) => bucket.members);
}

/** Children of a column must share one inline-start edge. */
export const columnEdge: Rule = {
    name: "column-edge",
    check(nodes, options) {
        const violations: Violation[] = [];
        for (const measured of nodes) {
            if (!measured.node.hasAttribute("data-audit-column")) continue;
            const children = inFlowChildren(measured.node).map((node, index) => ({
                node,
                index,
                rect: node.getBoundingClientRect(),
            }));
            if (children.length < 2) continue;

            for (const group of overlapping(children, "inline")) {
                const stack = group.sort((a, b) => a.index - b.index);
                const reference = stack[0]?.rect.left;
                if (stack.length < 2 || reference === undefined) continue;
                for (const child of stack) {
                    const delta = Math.abs(child.rect.left - reference);
                    if (delta <= options.tolerance) continue;
                    violations.push({
                        rule: "column-edge",
                        severity: "error",
                        path: `${measured.path} > ${child.index}`,
                        message: `inline-start edge differs from the column by ${delta.toFixed(2)}px`,
                        measured: Number(child.rect.left.toFixed(2)),
                        expected: Number(reference.toFixed(2)),
                        highlight: highlightOf(child.rect),
                    });
                }
            }
        }
        return violations;
    },
};

/** Children of a row must share one axis: their centres, or their first text baseline. */
export const rowAxis: Rule = {
    name: "row-axis",
    check(nodes, options) {
        const violations: Violation[] = [];
        for (const measured of nodes) {
            const mode = measured.node.getAttribute("data-audit-row");
            if (mode === null) continue;
            const children = inFlowChildren(measured.node)
                .map((node, index) => ({
                    node,
                    index,
                    rect: node.getBoundingClientRect(),
                    value: mode === "baseline" ? firstBaseline(node) : centreOf(node),
                }))
                .filter((child) => child.value !== null);
            if (children.length < 2) continue;

            for (const group of overlapping(children, "block")) {
                const line = group.sort((a, b) => a.index - b.index);
                const reference = line[0]?.value;
                if (line.length < 2 || reference === null || reference === undefined) continue;
                for (const child of line) {
                    const value = child.value as number;
                    const delta = Math.abs(value - reference);
                    // Half a pixel on top of the tolerance: a baseline is a rounded font metric.
                    if (delta <= options.tolerance + 0.5) continue;
                    violations.push({
                        rule: "row-axis",
                        severity: "error",
                        path: `${measured.path} > ${child.index}`,
                        message: `${mode} axis differs by ${delta.toFixed(2)}px`,
                        measured: Number(value.toFixed(2)),
                        expected: Number(reference.toFixed(2)),
                        highlight: highlightOf(child.rect),
                    });
                }
            }
        }
        return violations;
    },
};

/**
 * Split cells that share a container into the columns they actually form. Two figures are in one
 * column only when their inline ranges overlap; four statistics laid out across a row share a
 * container without sharing an edge, and comparing those is meaningless.
 */
function columns(group: Measured[]): Measured[][] {
    return overlapping(group, "inline").map((members) =>
        members.sort((a, b) => a.rect.top - b.rect.top),
    );
}

/** Numeric cells carry tabular figures and share an inline-end edge within one column. */
export const numericAlignment: Rule = {
    name: "numeric-alignment",
    check(nodes, options) {
        const violations: Violation[] = [];
        const byColumn = new Map<Element, Measured[]>();

        for (const measured of nodes) {
            if (!measured.node.hasAttribute("data-audit-numeric")) continue;

            if (!measured.style.fontVariantNumeric.includes("tabular-nums")) {
                violations.push({
                    rule: "numeric-alignment",
                    severity: "error",
                    path: measured.path,
                    message: "numeric cell does not use tabular figures",
                    measured: measured.style.fontVariantNumeric || "normal",
                    expected: "tabular-nums",
                    highlight: highlightOf(measured.rect),
                });
            }

            // Two levels up is the repeated row's container, which is what makes a column.
            const column = measured.node.parentElement?.parentElement;
            if (column === null || column === undefined) continue;
            const group = byColumn.get(column) ?? [];
            group.push(measured);
            byColumn.set(column, group);
        }

        for (const shared of byColumn.values()) {
            for (const group of columns(shared)) {
                if (group.length < 2) continue;
                const reference = (group[0] as Measured).rect.right;
                for (const measured of group) {
                    const delta = Math.abs(measured.rect.right - reference);
                    if (delta <= options.tolerance) continue;
                    violations.push({
                        rule: "numeric-alignment",
                        severity: "warning",
                        path: measured.path,
                        message: `numeric cell end edge differs by ${delta.toFixed(2)}px`,
                        measured: Number(measured.rect.right.toFixed(2)),
                        expected: Number(reference.toFixed(2)),
                        highlight: highlightOf(measured.rect),
                    });
                }
            }
        }
        return violations;
    },
};
