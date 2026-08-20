export const INTERACTIVE_SELECTOR =
    'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], ' +
    '[role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], ' +
    // A label wrapping a checkbox or radio is the real target under the standard form-control
    // pattern (see isLabelledFormControl below); a label wrapping a text input is not the same
    // case, and matching it here would measure one field as two overlapping targets.
    "[tabindex]:not([tabindex='-1']), label:has(> input[type='checkbox']), label:has(> input[type='radio'])";

/**
 * A checkbox or radio nested inside a <label> activates from anywhere in that label per the
 * standard form-control pattern; its own box is a compact visual token, not the real click
 * target, so target-size and touch-target measure the label instead and skip the input here.
 */
export function isLabelledFormControl(el: Element): boolean {
    if (el.tagName !== "INPUT") return false;
    const type = (el as HTMLInputElement).type;
    if (type !== "checkbox" && type !== "radio") return false;
    return el.closest("label") !== null;
}

/**
 * The rect a pointer actually activates: the element's own border box, widened by any padding
 * that is exposed (not covered by a child that already fills it). Most controls simply return
 * their own rect since their visible box already includes the padding used as hit area.
 */
export function activationRect(el: Element): DOMRect {
    return el.getBoundingClientRect();
}

/** The nearest ancestor (inclusive) whose overflow can scroll, or the document scrolling element. */
export function scrollContainer(el: Element): Element {
    let node: Element | null = el.parentElement;
    while (node !== null) {
        const style = getComputedStyle(node);
        const canScrollY = /(auto|scroll)/.test(style.overflowY);
        const canScrollX = /(auto|scroll)/.test(style.overflowX);
        if ((canScrollY || canScrollX) && node.scrollHeight > node.clientHeight) return node;
        node = node.parentElement;
    }
    return document.scrollingElement ?? document.documentElement;
}

function rectGap(a: DOMRect, b: DOMRect): number {
    const dx = Math.max(a.left - b.right, b.left - a.right, 0);
    const dy = Math.max(a.top - b.bottom, b.top - a.top - a.height, b.top - b.height, 0);
    // The horizontal-only and vertical-only cases dominate in practice (targets in a row or a
    // column); when neither axis separates them cleanly, fall back to centre distance.
    if (dx > 0 && dy === 0) return dx;
    if (dy > 0 && dx === 0) return dy;
    if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
    const acx = a.left + a.width / 2;
    const acy = a.top + a.height / 2;
    const bcx = b.left + b.width / 2;
    const bcy = b.top + b.height / 2;
    return Math.hypot(acx - bcx, acy - bcy);
}

/**
 * The closest other interactive element sharing `el`'s scroll container, and the gap to it. A
 * candidate that contains `el` or that `el` contains, such as a <label> wrapping the very
 * <input> being measured, is not a second target beside the first; the two markup elements are
 * one activation area under the standard form-control pattern, not two neighbours competing for
 * clear space.
 */
export function nearestNeighbour(
    el: Element,
    candidates: Element[],
): { el: Element; gap: number } | null {
    const rect = activationRect(el);
    const container = scrollContainer(el);
    let best: { el: Element; gap: number } | null = null;
    for (const candidate of candidates) {
        if (candidate === el) continue;
        if (candidate.contains(el) || el.contains(candidate)) continue;
        if (scrollContainer(candidate) !== container) continue;
        const gap = rectGap(rect, activationRect(candidate));
        if (best === null || gap < best.gap) best = { el: candidate, gap };
    }
    return best;
}

function firstNonEmptyTextNode(el: Element): Text | null {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            return (node.textContent ?? "").trim().length > 0
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_SKIP;
        },
    });
    const node = walker.nextNode();
    return node === null ? null : (node as Text);
}

/**
 * The first form control under `el`, in document order, that would carry the same visual
 * text-start position a reader's eye lands on (its value or placeholder), even though neither
 * lives in the accessibility tree as a text node a Range can select.
 */
function firstTextLikeControl(el: Element): Element | null {
    if (el.tagName === "TEXTAREA") return el;
    if (el.tagName === "INPUT") {
        // A checkbox or radio has no text-shaped value; its own visual position, a small box
        // beside its label, is not the field-group text start this function stands in for.
        const type = (el as HTMLInputElement).type;
        return type === "checkbox" || type === "radio" ? null : el;
    }
    for (const child of el.children) {
        const found = firstTextLikeControl(child);
        if (found !== null) return found;
    }
    return null;
}

/**
 * Left edge (right edge under RTL) of the first glyph of the first non-empty text node in `el`,
 * or of an input/textarea's own padded content box when one appears before any text node does:
 * an <input> can never contain a text node, so without this its own visual text start would be
 * skipped in favour of whatever text node follows it, such as a trailing button's glyph. A
 * <label> is a stronger case still: its own leading text ("Username") is a caption above the
 * field, not the column's alignment target, so a <label> always measures its control if it has
 * one, regardless of which comes first in the markup.
 */
export function firstGlyphEdge(el: Element): number | null {
    const textNode = firstNonEmptyTextNode(el);
    const control = firstTextLikeControl(el);
    const alwaysPreferControl = el.tagName === "LABEL";
    if (
        control !== null &&
        (alwaysPreferControl ||
            textNode === null ||
            control.compareDocumentPosition(textNode) & Node.DOCUMENT_POSITION_FOLLOWING)
    ) {
        const rect = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        const rtl = style.direction === "rtl";
        const paddingStart = Number.parseFloat(rtl ? style.paddingRight : style.paddingLeft) || 0;
        const borderStart = Number.parseFloat(rtl ? style.borderRightWidth : style.borderLeftWidth) || 0;
        return rtl ? rect.right - paddingStart - borderStart : rect.left + paddingStart + borderStart;
    }
    if (textNode === null) return null;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rects = range.getClientRects();
    if (rects.length === 0) return null;
    const rtl = getComputedStyle(el).direction === "rtl";
    return rtl ? (rects[0]?.right ?? null) : (rects[0]?.left ?? null);
}

/** Baseline (bottom edge) of the first glyph of the first non-empty text node in `el`. */
export function firstBaseline(el: Element): number | null {
    const textNode = firstNonEmptyTextNode(el);
    if (textNode === null) return null;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rects = range.getClientRects();
    return rects.length === 0 ? null : (rects[0]?.bottom ?? null);
}

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/**
 * A section heading (an h1-h6, an explicit role="heading", or a component opting out via
 * data-audit-heading) is read as a label above a column, not as one of its rows: Material's own
 * filled controls carry their own internal padding, which necessarily starts their box and ink
 * further in than a heading's bare text does. Comparing the two is the false positive the
 * column alignment rules would otherwise report on every card that opens with a title.
 */
export function isHeading(el: Element): boolean {
    return (
        HEADING_TAGS.has(el.tagName) ||
        el.getAttribute("role") === "heading" ||
        el.hasAttribute("data-audit-heading")
    );
}

/**
 * A wrapping chip group (port badges, tag lists) is a set of independently-padded pills, not a
 * line of body text or a column of boxes; its first chip's box and ink start inside that chip's
 * own padding by design, which is not the alignment the column rules mean to enforce.
 */
export function isWrappingGroup(el: Element): boolean {
    return getComputedStyle(el).flexWrap === "wrap";
}

/**
 * A child that is itself a declared column or row is judged by its own alignment pass, over its
 * own children; comparing its box or its first line's edge against the parent's other, unrelated
 * children conflates two different alignment groups into one and reports whichever one loses the
 * coin flip as a false positive.
 */
export function isOwnColumnOrRow(el: Element): boolean {
    return el.hasAttribute("data-audit-column") || el.hasAttribute("data-audit-row");
}

/**
 * Flexbox or grid centring on either axis makes the browser compute a box position from a
 * content-driven size, which is legitimately fractional or off the grid; a node so placed is
 * excluded from the offset and edge checks that assume a fixed, token-driven layout instead.
 */
export function isCentredByParent(el: Element): boolean {
    const parent = el.parentElement;
    if (parent === null) return false;
    const style = getComputedStyle(parent);
    const isFlexOrGrid = style.display === "flex" || style.display === "grid";
    if (isFlexOrGrid && (style.alignItems === "center" || style.justifyContent === "center")) {
        return true;
    }
    // text-align: center on the parent centres this element's own inline-block or block text
    // content the same way; a block-level child such as a <p> is affected by its own
    // text-align too, since the glyph position it produces is what is actually measured.
    return style.textAlign === "center" || getComputedStyle(el).textAlign === "center";
}

/**
 * An element whose block size comes from the flex layout around it rather than its own declared
 * height, through either mechanism flexbox offers: `flex-grow` consuming the main axis's leftover
 * space (a column filling the rest of a vertical shell), or the default `align-items: stretch`
 * filling the cross axis (a sidebar in a horizontal row stretched to the row's own height). The
 * block-size floor either produces is the viewport height minus whatever fixed chrome sits
 * beside it, and that difference is not guaranteed to land on the 4px grid even though every
 * value that produced it is a token; the viewport height, unlike every size this codebase
 * controls, is not one.
 */
export function fillsRemainingFlexSpace(el: Element): boolean {
    const style = getComputedStyle(el);
    const parent = el.parentElement;
    if (parent === null) return false;
    const parentStyle = getComputedStyle(parent);
    if (parentStyle.display !== "flex") return false;

    if (parentStyle.flexDirection === "column" || parentStyle.flexDirection === "column-reverse") {
        return Number.parseFloat(style.flexGrow) > 0;
    }
    const alignSelf = style.alignSelf === "auto" ? parentStyle.alignItems : style.alignSelf;
    return alignSelf === "stretch" || alignSelf === "normal";
}

/**
 * A CSS grid whose own track list is proportional (an `fr` unit) rather than token-sized
 * necessarily produces a track boundary wherever the container's own width divides, which is
 * legitimately fractional and not a design defect. getComputedStyle resolves `fr` tracks to
 * their used pixel widths, so the declared unit is gone by the time this runs; a non-integer
 * resolved track width is the signal left standing in for it, since a fixed or token-sized grid
 * always resolves to whole pixels.
 */
export function hasProportionalGridParent(el: Element): boolean {
    const parent = el.parentElement;
    if (parent === null) return false;
    const style = getComputedStyle(parent);
    if (style.display !== "grid") return false;
    const tracks = `${style.gridTemplateColumns} ${style.gridTemplateRows}`.split(/\s+/);
    return tracks.some((track) => {
        const px = Number.parseFloat(track);
        return track.endsWith("px") && Number.isFinite(px) && !Number.isInteger(px);
    });
}

/** Statistical mode of a set of numbers rounded to `precision`, ties broken by first occurrence. */
export function mode(values: number[], precision = 0.5): number | null {
    if (values.length === 0) return null;
    const counts = new Map<number, number>();
    for (const value of values) {
        const bucket = Math.round(value / precision) * precision;
        counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    let best = values[0] as number;
    let bestCount = 0;
    for (const [bucket, count] of counts) {
        if (count > bestCount) {
            bestCount = count;
            best = bucket;
        }
    }
    return best;
}
