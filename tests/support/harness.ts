import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createServer as createHttpServer } from "node:http";
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

const scenarioServers = new Map<ScenarioName, Promise<ScenarioServers>>();

const FRONTEND_ROOT = new URL("../../frontend", import.meta.url);

async function getScenarioServers(scenario: ScenarioName): Promise<ScenarioServers> {
    const existing = scenarioServers.get(scenario);
    if (existing !== undefined) return existing;

    const promise = (async (): Promise<ScenarioServers> => {
        const fixturePort = await freePort();
        const fixture = await startFixtureServer(scenario, fixturePort);

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
            },
            logLevel: "silent",
        });
        await vite.listen();

        return { fixture, vite, baseUrl: `http://127.0.0.1:${vitePort}` };
    })();
    scenarioServers.set(scenario, promise);
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
    const servers = await getScenarioServers(cell.scenario);
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
    await page.fill('input[autocomplete="username"]', "fixture");
    await page.fill('input[autocomplete="current-password"]', "fixture-password-1");
    await page.click('button[type="submit"]');
    await page.waitForSelector("h1", { timeout: 10_000 });

    const path = SCREEN_PATHS[cell.screen];
    if (path !== "/") {
        await page.goto(`${servers.baseUrl}${path}`);
    }
    if (cell.screen === "stack-edit") {
        const editButton = page.getByRole("button", { name: /edit/i }).first();
        if ((await editButton.count()) > 0) await editButton.click();
    }
    await settle(page);

    return {
        page,
        context,
        done: async () => {
            await context.close();
        },
    };
}
