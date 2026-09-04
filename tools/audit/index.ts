import { columnEdge } from "./rules/column-edge.ts";
import { collision } from "./rules/collision.ts";
import { contrast } from "./rules/contrast.ts";
import { focusVisible } from "./rules/focus-visible.ts";
import { glyphEdge } from "./rules/glyph-edge.ts";
import { inViewport } from "./rules/in-viewport.ts";
import { numericAlignment } from "./rules/numeric-alignment.ts";
import { overflow } from "./rules/overflow.ts";
import { rowAxis } from "./rules/row-axis.ts";
import { targetSize } from "./rules/target-size.ts";
import { tokenUsage } from "./rules/token-usage.ts";
import { touchTarget } from "./rules/touch-target.ts";
import type { AuditOptions, Exemption, Measured, Rule, Violation } from "./rules/types.ts";

export type { AuditOptions, Exemption, Measured, Rule, Violation } from "./rules/types.ts";

/**
 * Every rule module, in declaration order. The overlay and the CI matrix both import this
 * array directly, so there is exactly one implementation of every rule.
 */
export const RULES: Rule[] = [
    tokenUsage,
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

const FONT_READY_TIMEOUT_MS = 10_000;

async function fontsReady(timeoutMs: number): Promise<void> {
    const timeout = new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("fonts did not load")), timeoutMs);
    });
    await Promise.race([document.fonts.ready, timeout]);
}

function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function describeAnimation(animation: Animation): string {
    const effect = animation.effect;
    const target = effect instanceof KeyframeEffect ? effect.target : null;
    if (target instanceof Element) {
        return target.getAttribute("data-audit-id") ?? target.tagName.toLowerCase();
    }
    return animation.id || "unknown element";
}

/**
 * Two animation frames, then a guard: every animation and transition is disabled by the
 * verification stylesheet the harness injects, so anything still running at this point is a
 * genuine settle failure, not something this function needs to wait out.
 */
async function settle(): Promise<void> {
    await nextFrame();
    await nextFrame();
    const running = document.getAnimations().filter((animation) => {
        if (animation.playState !== "running") return false;
        const effect = animation.effect;
        const target = effect instanceof KeyframeEffect ? effect.target : null;
        if (target instanceof Element && target.closest("[data-audit-volatile]") !== null) {
            return false;
        }
        return true;
    });
    if (running.length > 0) {
        throw new Error(`page did not settle: ${describeAnimation(running[0] as Animation)}`);
    }
}

function isHidden(el: Element): boolean {
    if (el.hasAttribute("hidden")) return true;
    const style = getComputedStyle(el);
    return style.display === "none" || style.visibility === "hidden";
}

function auditPath(el: Element, root: Element): string {
    const segments: string[] = [];
    let node: Element | null = el;
    while (node !== null && node !== root.parentElement) {
        const id = node.getAttribute("data-audit-id");
        if (id !== null) {
            segments.unshift(id);
        } else if (node === el) {
            const parent = node.parentElement;
            const index = parent === null ? 0 : Array.prototype.indexOf.call(parent.children, node);
            segments.unshift(`${node.tagName.toLowerCase()}[${index}]`);
        }
        if (node === root) break;
        node = node.parentElement;
    }
    return segments.join("/");
}

/**
 * A third-party renderer's own internal markup (CodeMirror's line divs, xterm's character-cell
 * canvas wrapper) is not this design system's DOM at all; walking into it produces geometry no
 * rule here can meaningfully judge. [data-audit-opaque] stops the walk at the element itself,
 * which is still measured and still subject to every rule, but nothing under it is.
 */
function walk(root: Element): Measured[] {
    const out: Measured[] = [];
    const stack: Element[] = [root];
    while (stack.length > 0) {
        const el = stack.pop() as Element;
        if (isHidden(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0 || el === root) {
            out.push({ node: el, path: auditPath(el, root), rect, style: getComputedStyle(el) });
        }
        if (el.hasAttribute("data-audit-opaque")) continue;
        for (const child of el.children) stack.push(child);
    }
    return out;
}

function matchesExemption(violation: Violation, exemption: Exemption): boolean {
    if (violation.rule !== exemption.rule) return false;
    const target = document.querySelector(exemption.selector);
    if (target === null) return false;
    // The report attaches only a path string to a violation, so matching re-derives the node
    // set from the selector and checks the violating path is a descendant path of one of them.
    const matches = document.querySelectorAll(exemption.selector);
    for (const candidate of matches) {
        const candidatePath = candidate.getAttribute("data-audit-id") ?? "";
        if (candidatePath.length > 0 && violation.path.includes(candidatePath)) return true;
    }
    return false;
}

interface ExemptionUsage {
    entry: Exemption;
    matchCount: number;
}

function applyExemptions(
    violations: Violation[],
    exemptions: Exemption[],
): { kept: Violation[]; usage: ExemptionUsage[] } {
    const usage = exemptions.map((entry) => ({ entry, matchCount: 0 }));
    const kept: Violation[] = [];
    for (const violation of violations) {
        let exempted = false;
        for (const use of usage) {
            if (matchesExemption(violation, use.entry)) {
                use.matchCount += 1;
                exempted = true;
            }
        }
        if (!exempted) kept.push(violation);
    }
    for (const use of usage) {
        if (use.matchCount > use.entry.maxMatches) {
            kept.push({
                rule: use.entry.rule,
                severity: "error",
                path: use.entry.selector,
                message: `exemption "${use.entry.id}" matched ${use.matchCount} elements, over its ceiling of ${use.entry.maxMatches}`,
                measured: use.matchCount,
                expected: use.entry.maxMatches,
                highlight: { x: 0, y: 0, width: 0, height: 0 },
            });
        }
    }
    return { kept, usage };
}

/**
 * Walk the audit root, measure every visible element once, run every rule, and return the
 * violations that no exemption matches.
 *
 * Waits for font loading and for layout to settle before measuring.
 */
export interface ExemptionUsageEntry {
    id: string;
    rule: string;
    matchCount: number;
}

interface AuditRun {
    violations: Violation[];
    usage: ExemptionUsageEntry[];
}

async function runAudit(options: AuditOptions): Promise<AuditRun> {
    await fontsReady(FONT_READY_TIMEOUT_MS);
    await settle();

    const root = document.querySelector("[data-audit-root]") ?? document.body;
    const nodes = walk(root);
    const skip = new Set(options.skip ?? []);

    const measuring = RULES.filter((rule) => rule.mutates !== true && !skip.has(rule.name));
    const mutating = RULES.filter((rule) => rule.mutates === true && !skip.has(rule.name));

    const violations: Violation[] = [];
    for (const rule of measuring) violations.push(...rule.check(nodes, options));
    for (const rule of mutating) violations.push(...rule.check(nodes, options));

    const { kept, usage } = applyExemptions(violations, options.exemptions);
    return {
        violations: kept,
        usage: usage.map((u) => ({ id: u.entry.id, rule: u.entry.rule, matchCount: u.matchCount })),
    };
}

/**
 * Walk the audit root, measure every visible element once, run every rule, and return the
 * violations that no exemption matches.
 *
 * Waits for font loading and for layout to settle before measuring.
 */
export async function audit(options: AuditOptions): Promise<Violation[]> {
    return (await runAudit(options)).violations;
}

/** Same as `audit`, but also returns per-exemption match counts for the report's stale check. */
export async function auditWithUsage(options: AuditOptions): Promise<AuditRun> {
    return runAudit(options);
}
