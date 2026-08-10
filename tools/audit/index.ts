import { RULES } from "./rules/index.ts";
import type { AuditOptions, Exemption, Measured, Violation } from "./rules/types.ts";
import { SUBTREE_RULE, inExcludedSurface, pathOf } from "./rules/shared.ts";

import type { LedgerEntry } from "./contract.ts";

export type { AuditOptions, Exemption, Measured, Violation } from "./rules/types.ts";
export type { LedgerEntry, Severity } from "./contract.ts";

const FONT_TIMEOUT_MS = 10_000;
const ANIMATION_TIMEOUT_MS = 2_000;

export interface AuditRun {
    violations: Violation[];
    ledger: LedgerEntry[];
}

const SELECTOR_PATTERN = /^\[data-audit-id=['"]([^'"]+)['"]\]$/;

function idOf(selector: string): string | null {
    return SELECTOR_PATTERN.exec(selector)?.[1] ?? null;
}

function frame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Wait for the page to stop changing. Fonts first, because text metrics taken before the webfont
 * resolves are wrong rather than merely early; then two frames for layout and paint; then any
 * animation the verification stylesheet did not manage to zero.
 */
async function settle(): Promise<string | null> {
    const timeout = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), FONT_TIMEOUT_MS),
    );
    const loaded = await Promise.race([document.fonts.ready.then(() => "ready" as const), timeout]);
    if (loaded === "timeout") throw new Error("fonts did not load");

    await frame();
    await frame();

    const deadline = Date.now() + ANIMATION_TIMEOUT_MS;
    let running = document.getAnimations().filter((animation) => animation.playState === "running");
    while (running.length > 0 && Date.now() < deadline) {
        await frame();
        running = document.getAnimations().filter((animation) => animation.playState === "running");
    }
    return running.length > 0 ? `${running.length} animations still running` : null;
}

function collect(root: Element, exemptions: Exemption[]): Measured[] {
    const nodes: Measured[] = [];
    for (const element of [root, ...root.querySelectorAll("*")]) {
        if (element.hasAttribute("hidden")) continue;
        if (inExcludedSurface(element, exemptions)) continue;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;
        // Clipped away for sighted users. It exists for assistive technology and carries no design.
        if (style.clipPath.includes("inset(50%")) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        nodes.push({ node: element, path: pathOf(element, root), rect, style });
    }
    return nodes;
}

/**
 * Drop violations an exemption covers, and record how many distinct paths each one silenced so the
 * ceiling and the staleness check have something to read.
 */
function applyExemptions(
    violations: Violation[],
    exemptions: Exemption[],
): { kept: Violation[]; ledger: LedgerEntry[] } {
    const silenced = new Map<string, Set<string>>();
    const kept: Violation[] = [];

    for (const violation of violations) {
        const segments = violation.path.split(" / ");
        const match = exemptions.find((exemption) => {
            if (exemption.rule === SUBTREE_RULE) return false;
            if (exemption.rule !== violation.rule) return false;
            const id = idOf(exemption.selector);
            return id !== null && segments.includes(id);
        });
        if (match === undefined) {
            kept.push(violation);
            continue;
        }
        const paths = silenced.get(match.id) ?? new Set<string>();
        paths.add(violation.path);
        silenced.set(match.id, paths);
    }

    const ledger: LedgerEntry[] = exemptions.map((exemption) => {
        // A subtree entry silences nothing; it removes elements from measurement, so what it is
        // worth counting is how many of those surfaces the page actually has.
        const matches =
            exemption.rule === SUBTREE_RULE
                ? document.querySelectorAll(exemption.selector).length
                : (silenced.get(exemption.id)?.size ?? 0);
        return {
            id: exemption.id,
            rule: exemption.rule,
            matches,
            exceeded: matches > exemption.maxMatches,
        };
    });

    for (const entry of ledger) {
        if (!entry.exceeded) continue;
        const exemption = exemptions.find((candidate) => candidate.id === entry.id) as Exemption;
        kept.push({
            rule: "exemption-ceiling",
            severity: "error",
            path: exemption.selector,
            message: `exemption ${entry.id} matched ${entry.matches} elements`,
            measured: entry.matches,
            expected: exemption.maxMatches,
            highlight: { x: 0, y: 0, width: window.innerWidth, height: 40 },
        });
    }

    return { kept, ledger };
}

/** Walk the audit root, measure every visible element once, and run every rule. */
export async function auditRun(options: AuditOptions): Promise<AuditRun> {
    const unsettled = await settle();

    const root = document.querySelector("[data-audit-root]");
    if (root === null) {
        return {
            violations: [
                {
                    rule: "audit-root",
                    severity: "error",
                    path: "document",
                    message: "no [data-audit-root] element is present",
                    measured: "absent",
                    expected: "present",
                    highlight: { x: 0, y: 0, width: window.innerWidth, height: 40 },
                },
            ],
            ledger: [],
        };
    }

    const nodes = collect(root, options.exemptions);
    const skip = new Set(options.skip ?? []);
    const active = RULES.filter((rule) => !skip.has(rule.name));

    const raw: Violation[] = [];
    // Measuring rules first: a rule that moves focus would invalidate every rect taken after it.
    for (const rule of active.filter((candidate) => candidate.mutates !== true)) {
        raw.push(...rule.check(nodes, options));
    }
    for (const rule of active.filter((candidate) => candidate.mutates === true)) {
        raw.push(...rule.check(nodes, options));
    }

    if (unsettled !== null) {
        raw.push({
            rule: "settle",
            severity: "error",
            path: "document",
            message: `the page did not settle: ${unsettled}`,
            measured: unsettled,
            expected: "no running animations",
            highlight: { x: 0, y: 0, width: window.innerWidth, height: 40 },
        });
    }

    const { kept, ledger } = applyExemptions(raw, options.exemptions);
    return { violations: kept, ledger };
}

/** The overlay's entry point, which has no use for the exemption ledger. */
export async function audit(options: AuditOptions): Promise<Violation[]> {
    const run = await auditRun(options);
    return run.violations;
}
