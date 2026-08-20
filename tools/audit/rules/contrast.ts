import type { Rule, Violation } from "./types.ts";

function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

function parseColor(value: string): Rgba | null {
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

/** Composite `fg` over `bg`, both already resolved to opaque or semi-transparent RGBA. */
function composite(fg: Rgba, bg: Rgba): Rgba {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
        a,
    };
}

function relativeLuminance(color: Rgba): number {
    const channel = (v: number): number => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(a: Rgba, b: Rgba): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
}

/** Walk from `el` up through ancestors compositing every semi-transparent background found. */
function effectiveBackground(el: Element): Rgba | null {
    let layers: Rgba[] = [];
    let node: Element | null = el;
    while (node !== null) {
        const bg = parseColor(getComputedStyle(node).backgroundColor);
        if (bg !== null && bg.a > 0) layers.push(bg);
        if (bg !== null && bg.a >= 0.999) break;
        node = node.parentElement;
    }
    if (layers.length === 0) return { r: 255, g: 255, b: 255, a: 1 };
    layers = layers.reverse();
    let result = layers[0] as Rgba;
    for (let i = 1; i < layers.length; i += 1) {
        result = composite(layers[i] as Rgba, result);
    }
    if (result.a < 0.999) return null; // never fully opaque: report contrast-unknown
    return result;
}

function isLargeText(style: CSSStyleDeclaration): boolean {
    const size = Number.parseFloat(style.fontSize);
    const weight = Number.parseInt(style.fontWeight, 10) || 400;
    return size >= 24 || (size >= 18.66 && weight >= 700);
}

function hasDirectText(el: Element): boolean {
    for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim().length > 0) {
            return true;
        }
    }
    return false;
}

/**
 * Text contrast at 4.5:1 (3:1 at large sizes), and 3:1 for a [data-audit-boundary] element's
 * border or outline against the adjacent background. Elements whose background cannot be
 * resolved to an opaque colour (an image, a gradient) are reported as `contrast-unknown`
 * warnings rather than silently passed.
 */
export const contrast: Rule = {
    name: "contrast",
    check(nodes) {
        const out: Violation[] = [];

        for (const node of nodes) {
            if (!hasDirectText(node.node)) continue;
            const fg = parseColor(node.style.color);
            if (fg === null) continue;
            const bg = effectiveBackground(node.node);
            if (bg === null) {
                out.push({
                    rule: "contrast",
                    severity: "warning",
                    path: node.path,
                    message: "contrast-unknown: background could not be resolved to an opaque colour",
                    measured: "unknown",
                    expected: "resolvable background",
                    highlight: highlightOf(node.rect),
                });
                continue;
            }
            const ratio = contrastRatio(composite(fg, bg), bg);
            const required = isLargeText(node.style) ? 3 : 4.5;
            if (ratio < required) {
                out.push({
                    rule: "contrast",
                    severity: "error",
                    path: node.path,
                    message: `text contrast ratio ${ratio.toFixed(2)}:1, requires ${required}:1`,
                    measured: Number(ratio.toFixed(2)),
                    expected: required,
                    highlight: highlightOf(node.rect),
                });
            }
        }

        for (const node of nodes) {
            if (!node.node.hasAttribute("data-audit-boundary")) continue;
            const borderColor = parseColor(node.style.borderColor || node.style.outlineColor);
            if (borderColor === null) continue;
            const bg = effectiveBackground(node.node.parentElement ?? node.node);
            if (bg === null) continue;
            const ratio = contrastRatio(composite(borderColor, bg), bg);
            if (ratio < 3) {
                out.push({
                    rule: "contrast",
                    severity: "error",
                    path: node.path,
                    message: `non-text boundary contrast ratio ${ratio.toFixed(2)}:1, requires 3:1`,
                    measured: Number(ratio.toFixed(2)),
                    expected: 3,
                    highlight: highlightOf(node.rect),
                });
            }
        }

        return out;
    },
};

export const __testables = { parseColor, composite, relativeLuminance, contrastRatio };
