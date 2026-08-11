import type { Exemption, Measured, Violation } from "./types.ts";

/** Anything the user can operate, for the target-size and focus-visible rules. */
export const INTERACTIVE_SELECTOR = [
    "a[href]",
    "button",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[role='link']",
    "[role='tab']",
    "[role='switch']",
    "[role='checkbox']",
    "[role='radio']",
    "[role='menuitem']",
    "[tabindex]:not([tabindex='-1'])",
].join(", ");

/** Surfaces where overlap is the point, excluded from the collision rule. */
export const OVERLAY_SELECTOR = "dialog, [popover], [role='dialog'], [role='menu'], [role='tooltip']";

export function highlightOf(rect: DOMRect): Violation["highlight"] {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

export function offGrid(value: number, unit: number, tolerance: number): boolean {
    const remainder = Math.abs(value % unit);
    return remainder > tolerance && remainder < unit - tolerance;
}

export function nearestMultiple(value: number, unit: number): number {
    return Math.round(value / unit) * unit;
}

let hairline: number | null = null;

/**
 * The one documented exception to the grid. A rule drawn a device pixel thick is a line rather than
 * a measurement, so a box exactly that tall is not off the grid.
 */
export function hairlineSize(): number {
    if (hairline === null) {
        const raw = getComputedStyle(document.documentElement).getPropertyValue("--hairline");
        const parsed = Number.parseFloat(raw);
        hairline = Number.isNaN(parsed) ? 1 : parsed;
    }
    return hairline;
}

/** The exemption rule name that excludes a whole subtree from measurement. */
export const SUBTREE_RULE = "subtree";

const cachedSelectors = new WeakMap<Exemption[], string | null>();

export function subtreeSelector(exemptions: Exemption[]): string | null {
    const cached = cachedSelectors.get(exemptions);
    if (cached !== undefined) return cached;
    const parts = exemptions
        .filter((exemption) => exemption.rule === SUBTREE_RULE)
        .map((exemption) => exemption.selector);
    const selector = parts.length === 0 ? null : parts.join(", ");
    cachedSelectors.set(exemptions, selector);
    return selector;
}

/**
 * Terminal and code editor surfaces are the character-cell exception. Which surfaces those are is
 * declared in design/exemptions.json, so the exclusion is reviewable instead of hidden here.
 */
export function inExcludedSurface(node: Element, exemptions: Exemption[]): boolean {
    const selector = subtreeSelector(exemptions);
    return selector !== null && node.closest(selector) !== null;
}

export function originFor(node: Element, nodes: Measured[]): Measured | null {
    const origin = node.closest("[data-grid-origin]");
    if (origin === null) return null;
    return nodes.find((candidate) => candidate.node === origin) ?? null;
}

/** Justify values that leave the first item on the container's main-start edge. */
const MAIN_START = new Set(["normal", "start", "flex-start", "left", "stretch"]);

/** Align values that put an item on the container's cross-start edge. */
const CROSS_START = new Set(["normal", "start", "flex-start", "self-start", "stretch"]);

export interface DeclaredAxes {
    inline: boolean;
    block: boolean;
}

/**
 * Which of a box's two start offsets the design states, rather than inherits from how much room
 * its siblings took. An offset that accumulates from inline extents is excluded for the same
 * reason inline extents themselves are not checked: a content-driven width is legitimately
 * fractional. Block extents are checked, so offsets that accumulate from those stay in scope.
 */
function declaredAxes(node: Element, style: CSSStyleDeclaration): DeclaredAxes {
    // An out-of-flow box sits where its own inset values put it, and those are authored.
    if (style.position === "absolute" || style.position === "fixed") {
        return { inline: true, block: true };
    }

    const parent = node.parentElement;
    if (parent === null) return { inline: true, block: true };
    const parentStyle = getComputedStyle(parent);
    const parentDisplay = parentStyle.display;

    // Track sizing places a grid item, and a track sized to its content is as fractional as a
    // content-driven width.
    if (parentDisplay.endsWith("grid")) return { inline: false, block: false };

    if (!parentDisplay.endsWith("flex")) {
        // Line layout places an inline-level box, from font metrics and whatever text precedes it.
        if (style.display.startsWith("inline")) return { inline: false, block: false };
        return { inline: true, block: true };
    }

    const row = parentStyle.flexDirection.startsWith("row");
    const packed = MAIN_START.has(parentStyle.justifyContent);
    // Along a row the main-axis position accumulates from inline extents, so only the first item
    // sits on a declared edge. Down a column it accumulates from block extents, so every item does.
    const main = packed && (!row || [...parent.children][0] === node);
    const align = style.alignSelf === "auto" ? parentStyle.alignItems : style.alignSelf;
    const cross = CROSS_START.has(align);
    return row ? { inline: main, block: cross } : { inline: cross, block: main };
}

/**
 * Offsets are measured from the grid origin, so an ancestor placed by content flow carries its
 * undeclared position down to everything inside it.
 */
export function declaredFromOrigin(node: Element, origin: Element): DeclaredAxes {
    let inline = true;
    let block = true;
    let current: Element | null = node;
    while (current !== null && current !== origin && (inline || block)) {
        const own = declaredAxes(current, getComputedStyle(current));
        inline = inline && own.inline;
        block = block && own.block;
        current = current.parentElement;
    }
    return { inline, block };
}

/** Children that take part in normal flow, which is what an alignment rule can speak about. */
export function inFlowChildren(node: Element): Element[] {
    return [...node.children].filter((child) => {
        const style = getComputedStyle(child);
        if (style.display === "none" || style.visibility === "hidden") return false;
        return style.position === "static" || style.position === "relative";
    });
}

const LABELABLE = "button, input, meter, output, progress, select, textarea";

/**
 * The area a pointer can actually hit. Clicking anywhere in a wrapping label activates its control,
 * so a checkbox drawn small inside a tall label row is as large as that row.
 */
export function activationRect(node: Element, rect: DOMRect): DOMRect {
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
export function scrollContainer(node: Element): Element {
    for (let current: Element | null = node; current !== null; current = current.parentElement) {
        const style = getComputedStyle(current);
        // A fixed box is anchored to the viewport wherever in the tree it was written, so the
        // content scrolling beneath it is not its neighbour either.
        if (style.position === "fixed") return node.ownerDocument.documentElement;
        if (current === node) continue;
        const overflow = `${style.overflowX} ${style.overflowY}`;
        if (overflow.includes("auto") || overflow.includes("scroll")) return current;
    }
    return node.ownerDocument.documentElement;
}

/**
 * Smallest gap between this rect and any other interactive rect, measured only along the axis on
 * which the two overlap. Diagonal neighbours do not crowd a target.
 */
export function nearestNeighbour(rect: DOMRect, others: DOMRect[]): number {
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

/** True while the primary pointer is a finger, which is what the touch floors are written for. */
export function coarsePointer(): boolean {
    return window.matchMedia("(pointer: coarse)").matches;
}

export function centreOf(element: Element): number | null {
    const rect = element.getBoundingClientRect();
    if (rect.height === 0) return null;
    return rect.top + rect.height / 2;
}

/** Visible to a reader, rather than present for assistive technology alone. */
function painted(node: Element, root: Element): boolean {
    for (let current: Element | null = node; current !== null; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (style.clipPath.includes("inset(50%")) return false;
        if (current === root) break;
    }
    return true;
}

/**
 * Rendered box of the first glyph run inside an element. A Range over the text node is the only way
 * to obtain it: the element's own border box starts at whatever padding a control carries, and a
 * reader aligns on ink rather than on boxes.
 */
export function firstTextRect(element: Element): DOMRect | null {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
        if ((text.textContent ?? "").trim() === "") continue;
        const holder = text.parentElement;
        if (holder !== null && !painted(holder, element)) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        const rects = range.getClientRects();
        if (rects.length > 0) return rects[0] as DOMRect;
    }
    return null;
}

export function firstBaseline(element: Element): number | null {
    return firstTextRect(element)?.bottom ?? null;
}

/**
 * Elements that draw a mark of their own rather than framing a label. Listed rather than excluded,
 * because a text field written without a type attribute is still a text field.
 */
const GRAPHIC = [
    "svg",
    "img",
    "canvas",
    "input:is([type='checkbox'], [type='radio'], [type='range'], [type='color'], [type='file'], [type='image'])",
].join(", ");

/**
 * Where the ink of a block begins. Usually that is its first glyph, because a pill draws a box
 * around a label and the label is what a reader aligns on. A checkbox, a radio and an icon are the
 * exception: they carry no label of their own, so the mark itself is the ink and it starts on the
 * box edge.
 */
export function firstInkRect(element: Element): DOMRect | null {
    const text = firstTextRect(element);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const graphic = node as Element;
        if (!graphic.matches(GRAPHIC)) continue;
        if ((graphic.textContent ?? "").trim() !== "") continue;
        if (!painted(graphic, element)) continue;
        const rect = graphic.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        // Whichever comes first along the block, since the walk is in document order and text may
        // precede the mark.
        if (text === null || rect.top < text.top - 1 || rect.left < text.left) return rect;
        return text;
    }
    return text;
}

/** Tag and authored classes, with the per-component hash Svelte appends stripped as noise. */
export function descriptorOf(node: Element): string {
    const classes = [...node.classList]
        .filter((name) => !/^svelte-[a-z0-9]+$/.test(name))
        .map((name) => `.${name}`)
        .join("");
    return `${node.tagName.toLowerCase()}${classes}`;
}

export function pathOf(node: Element, root: Element): string {
    const parts: string[] = [];
    let current: Element | null = node;
    while (current !== null && current !== root.parentElement) {
        const id = current.getAttribute("data-audit-id");
        if (id !== null) parts.unshift(id);
        current = current.parentElement;
    }
    // Without a leaf, an annotated element and everything inside it share one path, which is not
    // enough to find the offender.
    if (!node.hasAttribute("data-audit-id")) parts.push(descriptorOf(node));
    return parts.join(" / ");
}

export interface Colour {
    r: number;
    g: number;
    b: number;
    a: number;
}

/**
 * Parse a computed colour. Browsers serialise to `rgb()` or `color()` forms; anything this cannot
 * read returns null so the caller reports the element as unevaluable rather than guessing.
 */
export function parseColour(value: string): Colour | null {
    const text = value.trim();
    if (text === "" || text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    const numbers = text
        .replace(/^[a-z]+\(/i, "")
        .replace(/\)$/, "")
        .split(/[\s,/]+/)
        .filter((part) => part !== "")
        .map((part) => (part.endsWith("%") ? Number(part.slice(0, -1)) / 100 : Number(part)));
    if (!text.startsWith("rgb") || numbers.length < 3 || numbers.some((n) => Number.isNaN(n))) {
        return null;
    }
    return {
        r: numbers[0] as number,
        g: numbers[1] as number,
        b: numbers[2] as number,
        a: numbers.length > 3 ? (numbers[3] as number) : 1,
    };
}

/** Paint `over` onto `under`, both premultiplied by nothing: straight source-over compositing. */
export function composite(over: Colour, under: Colour): Colour {
    const alpha = over.a + under.a * (1 - over.a);
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (o: number, u: number): number =>
        (o * over.a + u * under.a * (1 - over.a)) / alpha;
    return { r: mix(over.r, under.r), g: mix(over.g, under.g), b: mix(over.b, under.b), a: alpha };
}

function channel(value: number): number {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

export function luminance(colour: Colour): number {
    return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
}

export function contrastRatio(a: Colour, b: Colour): number {
    const first = luminance(a);
    const second = luminance(b);
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Resolve what a element is painted over by compositing every ancestor background until one is
 * opaque. Returns null when no opaque layer is reachable, or when a background image or gradient
 * makes the answer unknowable.
 */
export function effectiveBackground(node: Element): Colour | null {
    let layer: Colour = { r: 0, g: 0, b: 0, a: 0 };
    let current: Element | null = node;
    while (current !== null) {
        const style = getComputedStyle(current);
        if (style.backgroundImage !== "none") return null;
        const colour = parseColour(style.backgroundColor);
        if (colour === null) return null;
        layer = composite(layer, colour);
        if (layer.a >= 0.999) return layer;
        current = current.parentElement;
    }
    // Nothing declared an opaque background, so the canvas shows through.
    const canvas = parseColour(getComputedStyle(document.documentElement).backgroundColor);
    if (canvas === null || canvas.a < 0.999) return null;
    return composite(layer, canvas);
}

/** True when the element holds text of its own rather than only element children. */
export function ownText(node: Element): string {
    let text = "";
    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? "";
    }
    return text.trim();
}
