import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { createServer, type ViteDevServer } from "vite";
import type { ScenarioName } from "../../tools/fixtures/data/index.ts";
import { startFixtureServer, type FixtureServer } from "../../tools/fixtures/server.ts";
import { screenPath, type Cell } from "./matrix.ts";

function freePort(): Promise<number> {
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    const probe = createHttpServer();
    probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const port = typeof address === "object" && address !== null ? address.port : 0;
        probe.close((error) => (error ? reject(error) : resolve(port)));
    });
    return promise;
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
 * expensive to start and cheap to reuse across every cell that shares a scenario, since
 * scenario data is immutable and the dev server holds no per-request state of its own.
 */
interface ScenarioServers {
    fixture: FixtureServer;
    vite: ViteDevServer;
    baseUrl: string;
}

const scenarioServers = new Map<string, Promise<ScenarioServers>>();

const FRONTEND_ROOT = new URL("../../frontend", import.meta.url);
const REPO_ROOT = new URL("../../", import.meta.url);

async function getScenarioServers(
    scenario: ScenarioName,
    needsSetup: boolean,
): Promise<ScenarioServers> {
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
            plugins: [react()],
            define: { FRONTEND_VERSION: JSON.stringify("test") },
            server: {
                port: vitePort,
                strictPort: true,
                host: "127.0.0.1",
                proxy: { "/ws": { target: `ws://127.0.0.1:${fixturePort}`, ws: true } },
                // `common/` sits outside the frontend root and the app imports it directly.
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

/** Close every scenario server started by openCell(). Call once after the whole run. */
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

/**
 * Zeroes every animation and transition, so a settled page has nothing running to catch.
 * Installed through an init script rather than addStyleTag: a style tag belongs to the
 * document it was added to, and every navigation after it would drop it.
 */
const VERIFICATION_STYLESHEET = `
*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
`;

async function settle(page: Page): Promise<void> {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
        const { promise, resolve } = Promise.withResolvers<void>();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        return promise;
    });
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
    await context.addInitScript(
        ({ locale, theme, css }: { locale: string; theme: string; css: string }) => {
            localStorage.setItem("locale", locale);
            localStorage.setItem("theme", theme);
            document.addEventListener("DOMContentLoaded", () => {
                const style = document.createElement("style");
                style.textContent = css;
                document.head.appendChild(style);
            });
        },
        { locale: cell.locale, theme: cell.theme, css: VERIFICATION_STYLESHEET },
    );
    const page = await context.newPage();

    await page.goto(`${servers.baseUrl}/`);
    await page.waitForSelector("h1", { timeout: 10_000 });

    // login and setup are the two screens a session never gets past; every other screen needs
    // an authenticated session first, so this is the only place a real login round trip runs.
    if (cell.screen !== "login" && cell.screen !== "setup") {
        await page.fill('input[autocomplete="username"]', "fixture");
        await page.fill('input[autocomplete="current-password"]', "fixture-password-1");
        await page.locator('input[autocomplete="current-password"]').press("Enter");
        // The login form itself carries an h1, so waiting for one proves nothing about the
        // login having resolved. The password field is gone only once the authenticated shell
        // has replaced the form.
        await page
            .locator('input[autocomplete="current-password"]')
            .waitFor({ state: "detached", timeout: 15_000 });
        await page.waitForSelector("h1", { timeout: 10_000 });

        const path = screenPath(cell);
        if (path !== "/") {
            await page.goto(`${servers.baseUrl}${path}`);
            await page.waitForSelector("h1", { timeout: 10_000 });
        }
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

const AXE_SCRIPT_PATH = fileURLToPath(
    new URL("../../node_modules/axe-core/axe.min.js", import.meta.url),
);

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

/** Inject axe-core and run the WCAG 2.1 AA rule set against the whole document. */
export async function runAxe(opened: OpenCell): Promise<AxeResult[]> {
    await opened.page.addScriptTag({ path: AXE_SCRIPT_PATH });
    return opened.page.evaluate(async () => {
        interface AxeGlobal {
            run(context: unknown, options: unknown): Promise<{ violations: AxeResult[] }>;
        }
        const axe = (window as unknown as { axe: AxeGlobal }).axe;
        const report = await axe.run(document.body, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        });
        return report.violations;
    });
}
