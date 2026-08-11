import type { Measured, Rule, Violation } from "./types.ts";
import {
    INTERACTIVE_SELECTOR,
    activationRect,
    coarsePointer,
    highlightOf,
    nearestNeighbour,
    ownText,
    scrollContainer,
} from "./shared.ts";

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

interface Target {
    path: string;
    rect: DOMRect;
    container: Element;
}

function targetsOf(nodes: Measured[]): Target[] {
    return nodes
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
}

function byContainer(targets: Target[]): Map<Element, DOMRect[]> {
    const neighbours = new Map<Element, DOMRect[]>();
    for (const measured of targets) {
        const known = neighbours.get(measured.container);
        if (known === undefined) neighbours.set(measured.container, [measured.rect]);
        else known.push(measured.rect);
    }
    return neighbours;
}

export const targetSize: Rule = {
    name: "target-size",
    check(nodes) {
        // A finger has its own floor and its own spacing, which touch-target asserts instead.
        if (coarsePointer()) return [];

        const violations: Violation[] = [];
        const targets = targetsOf(nodes);
        const neighbours = byContainer(targets);

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

/**
 * The same measurement under a finger. There is no clear-space branch here: a 32px target with room
 * around it is a cursor affordance, and the way to fit a working screen onto a phone is to show
 * fewer controls rather than smaller ones. Spacing scales with size, so a target that is already at
 * the floor needs less room around it than one below it.
 */
export const touchTarget: Rule = {
    name: "touch-target",
    check(nodes) {
        if (!coarsePointer()) return [];

        const violations: Violation[] = [];
        const targets = targetsOf(nodes);
        const neighbours = byContainer(targets);

        for (const measured of targets) {
            const width = measured.rect.width;
            const height = measured.rect.height;
            const size = `${width.toFixed(0)}x${height.toFixed(0)}`;

            if (width < COMFORTABLE || height < COMFORTABLE) {
                violations.push({
                    rule: "touch-target",
                    severity: "error",
                    path: measured.path,
                    message: `touch target is ${size}px, below the coarse-pointer floor`,
                    measured: size,
                    expected: `${COMFORTABLE}x${COMFORTABLE}`,
                    highlight: highlightOf(measured.rect),
                });
                continue;
            }

            // Every target that reaches here is at the floor on both axes, so the spacing that
            // scales with size settles on its top step; anything smaller failed above instead.
            const gap = nearestNeighbour(measured.rect, neighbours.get(measured.container) ?? []);
            if (gap >= CLEAR_SPACE) continue;
            violations.push({
                rule: "touch-target",
                severity: "error",
                path: measured.path,
                message: `touch target is ${size}px with only ${gap.toFixed(1)}px of clear space`,
                measured: Number(gap.toFixed(1)),
                expected: CLEAR_SPACE,
                highlight: highlightOf(measured.rect),
            });
        }
        return violations;
    },
};
