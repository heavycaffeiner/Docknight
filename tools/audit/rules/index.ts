import type { Rule } from "./types.ts";
import { columnEdge, glyphEdge, gridOffset, numericAlignment, originWidth, rowAxis } from "./geometry.ts";
import { collision, inViewport, overflow } from "./robustness.ts";
import { contrast } from "./contrast.ts";
import { focusVisible } from "./focusVisible.ts";
import { targetSize, touchTarget } from "./targetSize.ts";
import { tokenUsage } from "./tokens.ts";

/** Declaration order. Rules that mutate the page are deferred by the runner, not by this list. */
export const RULES: readonly Rule[] = [
    tokenUsage,
    gridOffset,
    originWidth,
    columnEdge,
    glyphEdge,
    rowAxis,
    numericAlignment,
    overflow,
    collision,
    inViewport,
    contrast,
    targetSize,
    touchTarget,
    focusVisible,
];

export * from "./types.ts";
export {
    collision,
    columnEdge,
    contrast,
    focusVisible,
    glyphEdge,
    gridOffset,
    inViewport,
    numericAlignment,
    originWidth,
    overflow,
    rowAxis,
    targetSize,
    touchTarget,
    tokenUsage,
};
