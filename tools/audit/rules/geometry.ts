import type { Measured, Rule, Violation } from "./types.ts";
import {
    centreOf,
    declaredFromOrigin,
    descriptorOf,
    firstBaseline,
    firstInkRect,
    hairlineSize,
    highlightOf,
    inFlowChildren,
    nearestMultiple,
    offGrid,
    originFor,
    subtreeSelector,
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

/**
 * Children of a column must also share one text column. A reader does not align on boxes, and a
 * filled control's ink starts inside its own padding, so a row led by a button reads as a third
 * column start even where every border box is on the same edge. The reference is the run's most
 * common glyph edge rather than its first child, because a heading that leads a form of fields is
 * as likely to be the outlier as the fields are.
 *
 * The claim is one text column per region, so a child that declares a column of its own is a region
 * of its own and is left to answer for the text inside it.
 */
export const glyphEdge: Rule = {
    name: "glyph-edge",
    check(nodes, options) {
        const excluded = subtreeSelector(options.exemptions);
        const violations: Violation[] = [];
        for (const measured of nodes) {
            if (!measured.node.hasAttribute("data-audit-column")) continue;
            const children = inFlowChildren(measured.node)
                .map((node, index) => ({ node, index, rect: node.getBoundingClientRect() }))
                .filter((child) => {
                    if (child.rect.width <= 0 || child.rect.height <= 0) return false;
                    if (child.node.hasAttribute("data-audit-column")) return false;
                    // A character-cell surface lays its own glyphs out from font metrics, so where
                    // its first one lands says nothing about this column.
                    return excluded === null || child.node.querySelector(excluded) === null;
                });
            if (children.length < 2) continue;

            // The column starts where the text does, which is the right edge of the ink when the
            // page runs right to left.
            const rtl = measured.style.direction === "rtl";

            for (const group of overlapping(children, "inline")) {
                const inked = group
                    // Centred and end-aligned text declares that it does not sit on the column, so
                    // measuring where it happens to begin measures its own length instead.
                    .filter((child) => startAligned(child.node, rtl))
                    .map((child) => {
                        const ink = firstInkRect(child.node);
                        return { ...child, edge: ink === null ? undefined : rtl ? ink.right : ink.left };
                    })
                    .filter((child): child is typeof child & { edge: number } => child.edge !== undefined)
                    .sort((a, b) => a.index - b.index);
                if (inked.length < 2) continue;

                const reference = modal(inked.map((child) => child.edge), options.tolerance, rtl);
                for (const child of inked) {
                    const delta = Math.abs(child.edge - reference);
                    if (delta <= options.tolerance) continue;
                    // Named where the child names itself, so an exemption has something to select;
                    // described otherwise, because an index alone does not say what to go and look at.
                    const id = child.node.getAttribute("data-audit-id");
                    violations.push({
                        rule: "glyph-edge",
                        severity: "error",
                        path: `${measured.path} / ${id ?? descriptorOf(child.node)}`,
                        message: `first glyph starts ${delta.toFixed(2)}px off the text column`,
                        measured: Number(child.edge.toFixed(2)),
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
 * Whether the element's text runs from the column's own edge. Centring and end alignment are how a
 * block states that it is placed by its own width, and a run of them starts wherever the words end.
 * The check walks into the first text-bearing descendant, because a block's own alignment is
 * inherited by whatever draws its first line.
 */
function startAligned(node: Element, rtl: boolean): boolean {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text !== null && (text.textContent ?? "").trim() === "") text = walker.nextNode();
    const holder = text?.parentElement ?? node;
    const align = getComputedStyle(holder).textAlign;
    return align === "start" || align === (rtl ? "right" : "left");
}

/** The most common value, within the tolerance. A tie goes to the outermost, which is the column. */
function modal(values: number[], tolerance: number, rtl: boolean): number {
    let best = values[0] as number;
    let bestCount = 0;
    for (const candidate of values) {
        const count = values.filter((other) => Math.abs(other - candidate) <= tolerance).length;
        const outer = rtl ? candidate > best : candidate < best;
        if (count > bestCount || (count === bestCount && outer)) {
            best = candidate;
            bestCount = count;
        }
    }
    return best;
}

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
