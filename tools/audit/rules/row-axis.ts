import { firstBaseline, INTERACTIVE_SELECTOR } from "./shared.ts";
import type { Measured, Rule, Violation } from "./types.ts";

function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function directChildren(row: Measured, all: Measured[]): Measured[] {
    return all.filter((n) => n.node.parentElement === row.node);
}

/**
 * Groups children by their approximate top position: a wrapping row (flex-wrap: wrap, common
 * on a tab bar under the pseudo-locale's longer labels) breaks into more than one visual line,
 * and only children sharing a line have any alignment relationship to assert. Centring or
 * baseline alignment within one line legitimately spreads each child's own top by up to its
 * height, which the mismatch this rule is meant to catch is smaller than; two lines, by
 * contrast, are offset by a whole line's height or more, so the midpoint of the shortest
 * child's own height is a safe line-break threshold between the two cases.
 */
function groupByLine(children: Measured[], tolerance: number): Measured[][] {
    const sorted = [...children].sort((a, b) => a.rect.top - b.rect.top);
    const minHeight = Math.min(...children.map((c) => c.rect.height), Infinity);
    const lineThreshold = Number.isFinite(minHeight) ? minHeight / 2 : tolerance;
    const lines: Measured[][] = [];
    for (const child of sorted) {
        const line = lines.at(-1);
        const lineTop = line === undefined ? undefined : Math.min(...line.map((c) => c.rect.top));
        if (lineTop !== undefined && child.rect.top - lineTop <= lineThreshold) {
            (line as Measured[]).push(child);
        } else {
            lines.push([child]);
        }
    }
    return lines;
}

function checkCenterLine(children: Measured[], tolerance: number): Violation[] {
    const out: Violation[] = [];
    const centers = children.map((c) => c.rect.top + c.rect.height / 2);
    const average = centers.reduce((a, b) => a + b, 0) / Math.max(centers.length, 1);
    children.forEach((child, i) => {
        const center = centers[i] as number;
        if (Math.abs(center - average) > tolerance) {
            out.push({
                rule: "row-axis",
                severity: "error",
                path: child.path,
                message: `block-axis centre is ${center}px, row's average centre is ${average}px`,
                measured: center,
                expected: average,
                highlight: highlightOf(child.rect),
            });
        }
    });
    return out;
}

function checkBaselineLine(children: Measured[], tolerance: number): Violation[] {
    const out: Violation[] = [];
    const baselines = children
        .map((child) => ({ child, baseline: firstBaseline(child.node) }))
        .filter((entry): entry is { child: Measured; baseline: number } => entry.baseline !== null);
    if (baselines.length < 2) return out;
    const average = baselines.reduce((a, b) => a + b.baseline, 0) / baselines.length;
    for (const { child, baseline } of baselines) {
        if (Math.abs(baseline - average) > tolerance) {
            out.push({
                rule: "row-axis",
                severity: "error",
                path: child.path,
                message: `first baseline is ${baseline}px, row's average baseline is ${average}px`,
                measured: baseline,
                expected: average,
                highlight: highlightOf(child.rect),
            });
        }
    }
    return out;
}

function checkMixedHeights(children: Measured[], tolerance: number): Violation[] {
    const interactive = children.filter((c) => c.node.matches(INTERACTIVE_SELECTOR));
    if (interactive.length < 2) return [];
    const heights = interactive.map((c) => c.rect.height);
    const min = Math.min(...heights);
    const max = Math.max(...heights);
    if (max - min <= tolerance) return [];
    const tallest = interactive[heights.indexOf(max)] as Measured;
    return [
        {
            rule: "row-axis",
            severity: "error",
            path: tallest.path,
            message: `mixed control heights in one row: ${min}px to ${max}px`,
            measured: max,
            expected: min,
            highlight: highlightOf(tallest.rect),
        },
    ];
}

/**
 * Children of a [data-audit-row] align on one axis (its "center" or "baseline" attribute
 * value), and every interactive child on the same visual line shares one height: a 32px pill
 * beside 40px buttons fails even when the centre axis holds, because the eye reads the outline.
 */
export const rowAxis: Rule = {
    name: "row-axis",
    check(nodes, options) {
        const out: Violation[] = [];
        const rows = nodes.filter((n) => n.node.hasAttribute("data-audit-row"));

        for (const row of rows) {
            const children = directChildren(row, nodes);
            const axisMode = row.node.getAttribute("data-audit-row");
            const lines = groupByLine(children, options.tolerance);

            for (const line of lines) {
                if (axisMode === "center") {
                    out.push(...checkCenterLine(line, options.tolerance));
                } else if (axisMode === "baseline") {
                    out.push(...checkBaselineLine(line, options.tolerance));
                }
                out.push(...checkMixedHeights(line, options.tolerance));
            }
        }
        return out;
    },
};
