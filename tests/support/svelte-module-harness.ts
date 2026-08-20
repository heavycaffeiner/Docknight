import { createServer as createHttpServer } from "node:http";
import type { Browser, Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createServer, type ViteDevServer } from "vite";

/**
 * A Svelte 5 rune (`$state`, `$derived`, `$effect`) is not valid plain JavaScript; it only
 * exists after the Svelte compiler processes the file. A `.svelte.ts` module therefore cannot
 * be imported directly by node:test, which runs uncompiled TypeScript. This harness compiles
 * and serves the real source through Vite and drives it inside a real Chromium page, so a
 * store's actual reactive behaviour is what gets tested, not a hand-written approximation of it.
 */
export interface SvelteModuleHarness {
    page: Page;
    baseUrl: string;
    close(): Promise<void>;
}

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

/** `root` is the Vite project root to serve, normally the `frontend/` directory. */
export async function startSvelteModuleHarness(root: URL): Promise<SvelteModuleHarness> {
    const port = await freePort();
    const server: ViteDevServer = await createServer({
        root: root.pathname,
        configFile: false,
        plugins: [svelte()],
        server: { port, strictPort: true, host: "127.0.0.1" },
        logLevel: "silent",
    });
    await server.listen();
    const baseUrl = `http://127.0.0.1:${port}`;

    const browser: Browser = await chromium.launch();
    const page = await browser.newPage();

    return {
        page,
        baseUrl,
        async close() {
            await page.close();
            await browser.close();
            await server.close();
        },
    };
}
