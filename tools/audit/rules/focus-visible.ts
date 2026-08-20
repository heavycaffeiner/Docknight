import { INTERACTIVE_SELECTOR } from "./shared.ts";
import type { Rule, Violation } from "./types.ts";

function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
    const match = /^rgba?\(([^)]+)\)$/.exec(value.trim());
    if (match === null) return null;
    const parts = (match[1] ?? "")
        .split(/[\s,/]+/)
        .filter((p) => p.length > 0)
        .map((p) => Number.parseFloat(p));
    const [r, g, b, a] = parts;
    if (r === undefined || g === undefined || b === undefined) return null;
    return { r, g, b, a: a ?? 1 };
}

function luminance(c: { r: number; g: number; b: number }): number {
    const channel = (v: number): number => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
    const la = luminance(a);
    const lb = luminance(b);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Focuses every interactive element in turn, re-measures its computed outline, and requires
 * both a non-none outline style and at least 3:1 contrast against the adjacent background. The
 * one rule that mutates page state; the auditor defers it until every measuring rule is done
 * and restores the original focus afterward.
 */
export const focusVisible: Rule = {
    name: "focus-visible",
    mutates: true,
    check(nodes) {
        const out: Violation[] = [];
        const originalFocus = document.activeElement as HTMLElement | null;

        for (const node of nodes) {
            if (!node.node.matches(INTERACTIVE_SELECTOR)) continue;
            const el = node.node as HTMLElement;
            if (typeof el.focus !== "function") continue;
            el.focus({ preventScroll: true });
            if (document.activeElement !== el) continue; // not focusable in practice, skip

            const style = getComputedStyle(el);
            if (style.outlineStyle === "none") {
                out.push({
                    rule: "focus-visible",
                    severity: "error",
                    path: node.path,
                    message: "no visible outline when focused",
                    measured: "none",
                    expected: "a non-none outline",
                    highlight: highlightOf(el.getBoundingClientRect()),
                });
                continue;
            }

            const outlineColor = parseColor(style.outlineColor);
            const parent = el.parentElement;
            const bgColor = parent === null ? null : parseColor(getComputedStyle(parent).backgroundColor);
            if (outlineColor !== null && bgColor !== null) {
                const ratio = contrastRatio(outlineColor, bgColor);
                if (ratio < 3) {
                    out.push({
                        rule: "focus-visible",
                        severity: "error",
                        path: node.path,
                        message: `focus outline contrast ratio ${ratio.toFixed(2)}:1, requires 3:1`,
                        measured: Number(ratio.toFixed(2)),
                        expected: 3,
                        highlight: highlightOf(el.getBoundingClientRect()),
                    });
                }
            }
        }

        originalFocus?.focus({ preventScroll: true });
        return out;
    },
};
