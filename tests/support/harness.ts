import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import type { AuditOptions, ExemptionUsageEntry, Violation } from "../../tools/audit/index.ts";
import { startFixtureServer, type FixtureServer } from "../../tools/fixtures/server.ts";
import type { ScenarioName } from "../../tools/fixtures/data/index.ts";
import { SCREEN_PATHS, type Cell } from "./matrix.ts";

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = createHttpServer();
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            const port = typeof address === "object" && address !== null ? address.port : 0;
            probe.close((error) => (error ? reject(error) : resolve(port)));
        });
    });
}

// A Promise cached before the launch resolves, not a Browser assigned after it: several
// cells can call getBrowser() concurrently, and checking a plain `Browser | null` between
// the check and the await lets two concurrent callers both see null and each launch a browser.
let sharedBrowserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
    sharedBrowserPromise ??= chromium.launch();
    return sharedBrowserPromise;
}

/**
 * One fixture server plus one Vite dev server proxying to it, per scenario. Both are
 * expensive to start (a fresh Vite instance costs real wall-clock seconds) and cheap to
 * reuse across every cell that shares a scenario, since scenario data is immutable and the
 * dev server holds no per-request state of its own.
 */
interface ScenarioServers {
    fixture: FixtureServer;
    vite: ViteDevServer;
    baseUrl: string;
}

const scenarioServers = new Map<string, Promise<ScenarioServers>>();

const FRONTEND_ROOT = new URL("../../frontend", import.meta.url);
const REPO_ROOT = new URL("../../", import.meta.url);

async function getScenarioServers(scenario: ScenarioName, needsSetup: boolean): Promise<ScenarioServers> {
    const key = `${scenario}:${String(needsSetup)}`;
    const existing = scenarioServers.get(key);
    if (existing !== undefined) return existing;

    const promise = (async (): Promise<ScenarioServers> => {
        const fixturePort = await freePort();
        const fixture = await startFixtureServer(scenario, fixturePort, { needsSetup });

        const vitePort = await freePort();
        const vite = await createServer({
            root: FRONTEND_ROOT.pathname,
            configFile: false,
            plugins: [svelte()],
            server: {
                port: vitePort,
                strictPort: true,
                host: "127.0.0.1",
                proxy: { "/ws": { target: `ws://127.0.0.1:${fixturePort}`, ws: true } },
                // The auditor lives under tools/audit, outside the frontend root; the layout
                // matrix and the dev overlay both need Vite to serve it as a real ES module
                // over /@fs/ so they import the one rule implementation rather than a copy.
                fs: { allow: [REPO_ROOT.pathname] },
            },
            logLevel: "silent",
        });
        await vite.listen();

        return { fixture, vite, baseUrl: `http://127.0.0.1:${vitePort}` };
    })();
    scenarioServers.set(key, promise);
    return promise;
}

/** Close every scenario server started by openCell(). Call once after the whole matrix runs. */
export async function closeAllScenarioServers(): Promise<void> {
    const all = await Promise.all([...scenarioServers.values()]);
    await Promise.all(all.map((s) => Promise.all([s.vite.close(), s.fixture.close()])));
    scenarioServers.clear();
    const browser = sharedBrowserPromise === null ? null : await sharedBrowserPromise;
    await browser?.close();
    sharedBrowserPromise = null;
}

export interface OpenCell {
    page: Page;
    context: BrowserContext;
    baseUrl: string;
    done: () => Promise<void>;
}

/** Zeroes every animation and transition, so `settle()`'s guard has nothing running to catch. */
const VERIFICATION_STYLESHEET = `
* { animation-duration: 0s !important; transition-duration: 0s !important; }
`;

async function settle(page: Page): Promise<void> {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            }),
    );
}

/**
 * Open a browser context emulating `cell.geometry` and `cell.theme` against the shared server
 * pair for `cell.scenario`, log in, and navigate to `cell.screen`.
 */
export async function openCell(cell: Cell): Promise<OpenCell> {
    const servers = await getScenarioServers(cell.scenario, cell.screen === "setup");
    const browser = await getBrowser();
    const context = await browser.newContext({
        viewport: { width: cell.geometry.width, height: cell.geometry.height },
        hasTouch: cell.geometry.touch,
        colorScheme: cell.theme,
        locale: cell.locale,
    });
    await context.addInitScript((locale: string) => {
        localStorage.setItem("locale", locale);
    }, cell.locale);
    const page = await context.newPage();
    await page.addStyleTag({ content: VERIFICATION_STYLESHEET });

    await page.goto(`${servers.baseUrl}/`);
    await page.waitForSelector("h1", { timeout: 10_000 });

    // login and setup are the two screens a session never gets past; every other screen needs
    // an authenticated session first, so this is the only place a real login round trip runs.
    if (cell.screen !== "login" && cell.screen !== "setup") {
        await page.fill('input[autocomplete="username"]', "fixture");
        await page.fill('input[autocomplete="current-password"]', "fixture-password-1");
        await page.click('button[type="submit"]');
        await page.waitForSelector("h1", { timeout: 10_000 });

        const path = SCREEN_PATHS[cell.screen];
        if (path !== "/") {
            await page.goto(`${servers.baseUrl}${path}`);
            await page.waitForSelector("h1", { timeout: 10_000 });
        }
    }
    if (cell.screen === "stack-edit") {
        // On a compact viewport the Edit action lives inside the bottom app bar's overflow
        // menu, not as a standalone button; open it first, on a wide one it is a direct button.
        // Neither branch can key off the button's own label text: the pseudo-locale rewrites
        // every string, so "Edit" and "More actions" are only ever found there under en. The
        // action bar's first non-icon button is "Edit" on a wide viewport by construction
        // (proposal 7's action order); [aria-haspopup="menu"] and [role="menuitem"] are
        // structural roles, stable under any locale, for the compact fallback.
        // The service data itself, and so the action bar, arrives over the WebSocket after
        // navigation resolves, so the direct button is given a real chance to appear before
        // falling back to the menu rather than deciding on a zero-delay count().
        const actionBar = page.locator(".action-bar, .bottom-app-bar").first();
        const directEditButton = actionBar.getByRole("button").first();
        const appeared = await directEditButton
            .waitFor({ state: "visible", timeout: 2_000 })
            .then(() => true)
            .catch(() => false);
        let editButton = directEditButton;
        if (!appeared) {
            await page.locator('[aria-haspopup="menu"]').last().click();
            editButton = page.getByRole("menuitem").first();
            await editButton.waitFor({ state: "visible", timeout: 10_000 });
        }
        await editButton.click();
    }
    await settle(page);

    return {
        page,
        context,
        baseUrl: servers.baseUrl,
        done: async () => {
            await context.close();
        },
    };
}

const EXEMPTIONS_PATH = new URL("../../design/exemptions.json", import.meta.url);
const AUDIT_ENTRY_PATH = fileURLToPath(new URL("../../tools/audit/index.ts", import.meta.url));

const ALL_RULE_NAMES = [
    "token-usage",
    "grid-offset",
    "column-edge",
    "glyph-edge",
    "row-axis",
    "numeric-alignment",
    "overflow",
    "collision",
    "in-viewport",
    "contrast",
    "target-size",
    "touch-target",
    "focus-visible",
];

function allRulesExcept(keep: string[]): string[] {
    return ALL_RULE_NAMES.filter((name) => !keep.includes(name));
}

interface ExemptionsFile {
    entries: AuditOptions["exemptions"];
}

function loadExemptions(): AuditOptions["exemptions"] {
    const parsed = JSON.parse(readFileSync(EXEMPTIONS_PATH, "utf8")) as ExemptionsFile;
    return parsed.entries;
}

function auditOptionsFor(cell: Cell): AuditOptions {
    return {
        unit: 4,
        tolerance: 0.5,
        coarsePointer: cell.geometry.touch,
        exemptions: loadExemptions(),
        ...(cell.rules === undefined ? {} : { skip: allRulesExcept(cell.rules) }),
    };
}

/** Chromium's :focus-visible heuristic keys off the last real input event, not off
 * Element.focus() called from a script; one throwaway Tab keypress before the focus-visible
 * rule runs its own focus() calls is what makes its outline check observe the same style a
 * keyboard user actually sees, instead of the outline: none a mouse-driven focus gets. */
async function primeFocusVisible(opened: OpenCell): Promise<void> {
    await opened.page.keyboard.press("Tab");
}

/**
 * Import the auditor as a real ES module through the dev server (so the matrix and the dev
 * overlay share one implementation), and run it against the currently open page.
 */
export async function runAudit(opened: OpenCell, cell: Cell): Promise<Violation[]> {
    await primeFocusVisible(opened);
    const options = auditOptionsFor(cell);
    return opened.page.evaluate(
        async ({ auditUrl, opts }) => {
            const mod = (await import(/* @vite-ignore */ auditUrl)) as {
                audit: (o: typeof opts) => Promise<Violation[]>;
            };
            return mod.audit(opts);
        },
        { auditUrl: `${opened.baseUrl}/@fs/${AUDIT_ENTRY_PATH}`, opts: options },
    );
}

export interface AuditRunResult {
    violations: Violation[];
    usage: ExemptionUsageEntry[];
}

/** Same as `runAudit`, but also returns the exemption match counts the report's ledger needs. */
export async function runAuditWithUsage(opened: OpenCell, cell: Cell): Promise<AuditRunResult> {
    await primeFocusVisible(opened);
    const options = auditOptionsFor(cell);
    return opened.page.evaluate(
        async ({ auditUrl, opts }) => {
            const mod = (await import(/* @vite-ignore */ auditUrl)) as {
                auditWithUsage: (o: typeof opts) => Promise<AuditRunResult>;
            };
            return mod.auditWithUsage(opts);
        },
        { auditUrl: `${opened.baseUrl}/@fs/${AUDIT_ENTRY_PATH}`, opts: options },
    );
}

/** Crop a screenshot to a violation's highlight rect. Returns null when the rect is degenerate. */
export async function screenshotHighlight(
    opened: OpenCell,
    highlight: { x: number; y: number; width: number; height: number },
): Promise<string | null> {
    if (highlight.width <= 0 || highlight.height <= 0) return null;
    const buffer = await opened.page.screenshot({
        clip: {
            x: Math.max(0, highlight.x),
            y: Math.max(0, highlight.y),
            width: Math.max(1, highlight.width),
            height: Math.max(1, highlight.height),
        },
    });
    return buffer.toString("base64");
}

const AXE_SCRIPT_PATH = fileURLToPath(new URL("../../node_modules/axe-core/axe.min.js", import.meta.url));

export interface AxeNodeResult {
    html: string;
    target: string[];
    failureSummary?: string;
}

export interface AxeResult {
    id: string;
    impact: string | null;
    help: string;
    helpUrl: string;
    nodes: AxeNodeResult[];
}

/**
 * Inject axe-core and run it against the currently open page under the WCAG 2.1 AA rule set,
 * configured to the same [data-audit-root] boundary the auditor measures within.
 */
export async function runAxe(opened: OpenCell): Promise<AxeResult[]> {
    await opened.page.addScriptTag({ path: AXE_SCRIPT_PATH });
    const results = await opened.page.evaluate(async () => {
        interface AxeGlobal {
            run(
                context: unknown,
                options: unknown,
            ): Promise<{ violations: AxeResult[] }>;
        }
        const root = document.querySelector("[data-audit-root]") ?? document.body;
        const axe = (window as unknown as { axe: AxeGlobal }).axe;
        const report = await axe.run(root, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
        return report.violations;
    });
    return results;
}
