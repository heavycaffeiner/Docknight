import type { Rule, Violation } from "./types.ts";
import { INTERACTIVE_SELECTOR, highlightOf, ownText } from "./shared.ts";

/** The project's own floor, above the WCAG 2.5.8 minimum. */
const COMFORTABLE = 48;
/** Permitted when the target has clear space around it. */
const COMPACT = 32;
const CLEAR_SPACE = 8;

/** A link inside a sentence is explicitly exempt, because its size is the text's size. */
function inlineInText(node: Element): boolean {
    if (node.tagName !== "A") return false;
    const parent = node.parentElement;
    if (parent === null) return false;
    return ownText(parent) !== "";
}

const LABELABLE = "button, input, meter, output, progress, select, textarea";

/**
 * The area a pointer can actually hit. Clicking anywhere in a wrapping label activates its control,
 * so a checkbox drawn small inside a tall label row is as large as that row.
 */
function activationRect(node: Element, rect: DOMRect): DOMRect {
    if (!node.matches(LABELABLE)) return rect;
    const labels = (node as HTMLInputElement).labels;
    if (labels === null || labels === undefined) return rect;
    let widest = rect;
    for (const label of labels) {
        if (!label.contains(node)) continue;
        const other = label.getBoundingClientRect();
        if (other.width * other.height > widest.width * widest.height) widest = other;
    }
    return widest;
}

/**
 * Nearest ancestor that scrolls, or the document element. Two targets in different scroll containers
 * have no fixed distance between them: a bottom navigation bar sits over the content passing beneath
 * it, and comparing the two measures the scroll position rather than the layout.
 */
function scrollContainer(node: Element): Element {
    for (let current = node.parentElement; current !== null; current = current.parentElement) {
        const style = getComputedStyle(current);
        const overflow = `${style.overflowX} ${style.overflowY}`;
        if (overflow.includes("auto") || overflow.includes("scroll")) return current;
    }
    return node.ownerDocument.documentElement;
}

/**
 * Smallest gap between this rect and any other interactive rect, measured only along the axis on
 * which the two overlap. Diagonal neighbours do not crowd a target.
 */
function nearestNeighbour(rect: DOMRect, others: DOMRect[]): number {
    let closest = Number.POSITIVE_INFINITY;
    for (const other of others) {
        if (other === rect) continue;
        const overlapsBlock = other.bottom > rect.top && other.top < rect.bottom;
        const overlapsInline = other.right > rect.left && other.left < rect.right;
        if (overlapsBlock) {
            const gap = Math.max(other.left - rect.right, rect.left - other.right);
            if (gap >= 0) closest = Math.min(closest, gap);
            else closest = 0;
        }
        if (overlapsInline) {
            const gap = Math.max(other.top - rect.bottom, rect.top - other.bottom);
            if (gap >= 0) closest = Math.min(closest, gap);
            else closest = 0;
        }
    }
    return closest;
}

export const targetSize: Rule = {
    name: "target-size",
    check(nodes) {
        const violations: Violation[] = [];
        const targets = nodes
            .filter((measured) => {
                if (!measured.node.matches(INTERACTIVE_SELECTOR)) return false;
                if (inlineInText(measured.node)) return false;
                return measured.rect.width > 1 && measured.rect.height > 1;
            })
            .map((measured) => ({
                path: measured.path,
                rect: activationRect(measured.node, measured.rect),
                container: scrollContainer(measured.node),
            }));
        const neighbours = new Map<Element, DOMRect[]>();
        for (const measured of targets) {
            const known = neighbours.get(measured.container);
            if (known === undefined) neighbours.set(measured.container, [measured.rect]);
            else known.push(measured.rect);
        }

        for (const measured of targets) {
            const width = measured.rect.width;
            const height = measured.rect.height;
            if (width >= COMFORTABLE && height >= COMFORTABLE) continue;

            const size = `${width.toFixed(0)}x${height.toFixed(0)}`;
            if (width < COMPACT || height < COMPACT) {
                violations.push({
                    rule: "target-size",
                    severity: "error",
                    path: measured.path,
                    message: `pointer target is ${size}px, below the compact minimum`,
                    measured: size,
                    expected: `${COMPACT}x${COMPACT} with clear space, or ${COMFORTABLE}x${COMFORTABLE}`,
                    highlight: highlightOf(measured.rect),
                });
                continue;
            }

            const gap = nearestNeighbour(measured.rect, neighbours.get(measured.container) ?? []);
            if (gap >= CLEAR_SPACE) continue;
            violations.push({
                rule: "target-size",
                severity: "error",
                path: measured.path,
                message: `pointer target is ${size}px with only ${gap.toFixed(1)}px of clear space`,
                measured: Number(gap.toFixed(1)),
                expected: CLEAR_SPACE,
                highlight: highlightOf(measured.rect),
            });
        }
        return violations;
    },
};
