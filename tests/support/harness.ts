import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { AuditRun } from "../../tools/audit/index.ts";
import type { Exemption } from "../../tools/audit/rules/types.ts";
import { FIXTURE_TOKEN } from "../../tools/fixtures/data/scenarios.ts";
import { type Cell, originFor } from "./matrix.ts";

const AUDIT_BUNDLE = fileURLToPath(new URL("../../dist/audit/audit.js", import.meta.url));
const VERIFICATION_CSS = fileURLToPath(new URL("./verification.css", import.meta.url));

export const GRID_UNIT = 4;
export const TOLERANCE = 0.5;

const cache = new Map<string, string>();

async function textOf(path: string): Promise<string> {
    const held = cache.get(path);
    if (held !== undefined) return held;
    let body: string;
    try {
        body = await readFile(path, "utf8");
    } catch {
        throw new Error(`${path} is missing; run \`pnpm build\` and \`pnpm build:audit\` first`);
    }
    cache.set(path, body);
    return body;
}

/**
 * Put the page in the state a cell describes. State is seeded through localStorage before the first
 * script runs, because the alternative is driving a sign-in form on every one of a few hundred cells.
 */
export async function openCell(page: Page, cell: Cell): Promise<void> {
    await page.setViewportSize({ width: cell.width, height: 900 });

    const seed = {
        theme: cell.theme,
        locale: cell.locale,
        token: cell.anonymous ? null : FIXTURE_TOKEN,
    };
    await page.addInitScript((state: typeof seed) => {
        localStorage.setItem("theme", state.theme);
        localStorage.setItem("locale", state.locale);
        if (state.token !== null) {
            localStorage.setItem("token", state.token);
            localStorage.setItem("remember", "1");
        }
    }, seed);

    await page.goto(`${originFor(cell.scenario)}${cell.path}`, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: await textOf(VERIFICATION_CSS) });
    await page.waitForSelector("[data-audit-root]", { state: "attached", timeout: 15_000 });
    await settleDom(page);
}

/** No mutation outside a volatile region for this long counts as settled. */
const QUIET_MS = 150;

/** A blinking caret never stops mutating, so the wait is bounded rather than open-ended. */
const QUIET_LIMIT_MS = 1_500;

/**
 * Wait for the screen to stop filling in. A stack renders its statistics only once the first poll
 * answers, so a cell captured too early is a different page from the same cell captured a moment
 * later. Mutations inside a `[data-audit-volatile]` region do not count, because a terminal caret
 * blinks for as long as the page is open and would hold the wait at its limit every time.
 */
async function settleDom(page: Page): Promise<void> {
    await page.evaluate(
        ({ quiet, limit }: { quiet: number; limit: number }) =>
            new Promise<void>((resolve) => {
                let observer: MutationObserver | null = null;
                let quietTimer = 0;
                let limitTimer = 0;

                const finish = (): void => {
                    window.clearTimeout(quietTimer);
                    window.clearTimeout(limitTimer);
                    observer?.disconnect();
                    resolve();
                };

                const volatileRegion = (target: Node): boolean => {
                    const element = target instanceof Element ? target : target.parentElement;
                    if (element === null) return false;
                    return element.closest("[data-audit-volatile]") !== null;
                };

                observer = new MutationObserver((records) => {
                    if (records.every((record) => volatileRegion(record.target))) return;
                    window.clearTimeout(quietTimer);
                    quietTimer = window.setTimeout(finish, quiet);
                });
                observer.observe(document.documentElement, {
                    subtree: true,
                    childList: true,
                    characterData: true,
                    attributes: true,
                });

                quietTimer = window.setTimeout(finish, quiet);
                limitTimer = window.setTimeout(finish, limit);
            }),
        { quiet: QUIET_MS, limit: QUIET_LIMIT_MS },
    );
}

/** Wait for fonts and two frames. The auditor does this itself; screenshots need it separately. */
export async function settlePage(page: Page): Promise<void> {
    await page.evaluate(async () => {
        await document.fonts.ready;
        const frame = (): Promise<void> =>
            new Promise((resolve) => requestAnimationFrame(() => resolve()));
        await frame();
        await frame();
    });
}

/**
 * Chromium applies :focus-visible to a scripted focus() only once the page has seen a keyboard
 * event, so the focus rule would pass on an untouched page whatever the styles say.
 */
export async function armKeyboardModality(page: Page): Promise<void> {
    await page.keyboard.press("Tab");
    await page.evaluate(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
    });
}

interface AuditInput {
    only: string[] | null;
    exemptions: Exemption[];
    unit: number;
    tolerance: number;
}

export async function runAudit(page: Page, cell: Cell, exemptions: Exemption[]): Promise<AuditRun> {
    await page.addScriptTag({ content: await textOf(AUDIT_BUNDLE) });
    return await page.evaluate(async (input: AuditInput) => {
        const host = globalThis as unknown as {
            __docknightAudit?: (options: unknown) => Promise<AuditRun>;
            __docknightRules?: string[];
        };
        const run = host.__docknightAudit;
        const names = host.__docknightRules;
        if (run === undefined || names === undefined) throw new Error("the audit bundle did not load");
        const only = input.only;
        const skip = only === null ? [] : names.filter((name) => !only.includes(name));
        return await run({
            unit: input.unit,
            tolerance: input.tolerance,
            exemptions: input.exemptions,
            skip,
        });
    }, { only: cell.only, exemptions, unit: GRID_UNIT, tolerance: TOLERANCE });
}
