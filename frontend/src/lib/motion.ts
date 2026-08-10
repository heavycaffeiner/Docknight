import { easeEmphasized, easeEmphasizedDecel } from "m3-svelte";

/**
 * Durations and curves for the transitions Svelte drives from JavaScript. The CSS side reads
 * `--m3-util-easing-*` directly; those are unreachable from here, so the two Material curves used
 * for entrances and exits are imported instead.
 */

/** Material's short spatial duration, for a surface arriving or leaving. */
const SPATIAL_MS = 350;

/** Material's standard duration, for a fade with no movement. */
const STANDARD_MS = 200;

interface Params {
    duration: number;
    easing: (t: number) => number;
}

/**
 * A CSS transition is already clamped by the reduced-motion block in global.css, but a Svelte
 * transition runs off a JavaScript clock and never sees it, so every call site checks here. Read
 * per call rather than cached, so changing the preference takes effect without a reload.
 */
export function reducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A surface arriving: decelerating, so it settles rather than stops. */
export function arrive(): Params {
    return { duration: reducedMotion() ? 0 : SPATIAL_MS, easing: easeEmphasizedDecel };
}

/** A surface that moves both ways, such as one that grows and shrinks in place. */
export function shift(): Params {
    return { duration: reducedMotion() ? 0 : SPATIAL_MS, easing: easeEmphasized };
}

/** A change of state with no movement, such as a scrim or a label swap. */
export function fade(): Params {
    return { duration: reducedMotion() ? 0 : STANDARD_MS, easing: easeEmphasized };
}

/** Scroll behaviour for the same reason: `smooth` is a JavaScript-driven scroll in most engines. */
export function scrollBehavior(): ScrollBehavior {
    return reducedMotion() ? "auto" : "smooth";
}
