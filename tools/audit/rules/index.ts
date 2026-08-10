import type { Rule } from "./types.ts";
import { columnEdge, gridOffset, numericAlignment, originWidth, rowAxis } from "./geometry.ts";
import { collision, inViewport, overflow } from "./robustness.ts";
import { contrast } from "./contrast.ts";
import { focusVisible } from "./focusVisible.ts";
import { targetSize } from "./targetSize.ts";
import { tokenUsage } from "./tokens.ts";

/** Declaration order. Rules that mutate the page are deferred by the runner, not by this list. */
export const RULES: readonly Rule[] = [
    tokenUsage,
    gridOffset,
    originWidth,
    columnEdge,
    rowAxis,
    numericAlignment,
    overflow,
    collision,
    inViewport,
    contrast,
    targetSize,
    focusVisible,
];

export * from "./types.ts";
export {
    collision,
    columnEdge,
    contrast,
    focusVisible,
    gridOffset,
    inViewport,
    numericAlignment,
    originWidth,
    overflow,
    rowAxis,
    targetSize,
    tokenUsage,
};
