import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Page } from "@playwright/test";
import { startSvelteModuleHarness, type SvelteModuleHarness } from "../../../tests/support/svelte-module-harness.ts";
import type * as ViewportModule from "./viewport.svelte.ts";

/**
 * This is also the Safari-path coverage the design verification proposal requires:
 * Playwright never opens a real virtual keyboard, so `trackViewport` is exercised here
 * against a stubbed `visualViewport` inside a real, compiled build instead.
 */

let harness: SvelteModuleHarness;
let page: Page;

before(async () => {
    harness = await startSvelteModuleHarness(new URL("../..", import.meta.url));
    page = harness.page;
});

after(async () => {
    await harness.close();
});

/**
 * Load the harness page, stub `visualViewport` before the module runs, call `trackViewport()`,
 * and return the state the module published plus handles to drive further stub events.
 */
async function loadWithStub(clientHeight: number, viewportHeight: number, offsetTop = 0): Promise<void> {
    await page.goto(`${harness.baseUrl}/src/lib/viewport-harness.html`);
    await page.evaluate(
        ({ clientHeight, viewportHeight, offsetTop }) => {
            Object.defineProperty(document.documentElement, "clientHeight", {
                configurable: true,
                get: () => clientHeight,
            });
            const listeners = new Map<string, Set<() => void>>();
            const stub = {
                height: viewportHeight,
                offsetTop,
                addEventListener(type: string, fn: () => void) {
                    if (!listeners.has(type)) listeners.set(type, new Set());
                    listeners.get(type)?.add(fn);
                },
                removeEventListener(type: string, fn: () => void) {
                    listeners.get(type)?.delete(fn);
                },
            };
            (window as unknown as { __stubViewport: unknown }).__stubViewport = stub;
            (window as unknown as { __stubListeners: unknown }).__stubListeners = listeners;
            Object.defineProperty(window, "visualViewport", {
                configurable: true,
                get: () => stub,
            });
        },
        { clientHeight, viewportHeight, offsetTop },
    );
    await page.evaluate(async () => {
        // A genuine browser-runtime URL, not a filesystem path; built from a variable so the
        // TypeScript compiler does not try to statically resolve it as a module specifier.
        const modulePath = "/src/lib/viewport.svelte.ts";
        const mod = (await import(/* @vite-ignore */ modulePath)) as typeof ViewportModule;
        (window as unknown as { __unsubscribe: unknown }).__unsubscribe = mod.trackViewport();
        (window as unknown as { __keyboardOpen: unknown }).__keyboardOpen = mod.keyboardOpen;
    });
}

function readProp(name: string): Promise<string> {
    return page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name);
}

function readDataset(): Promise<string | undefined> {
    return page.evaluate(() => document.documentElement.dataset.keyboard);
}

test("without visualViewport, trackViewport is a no-op and returns a working unsubscribe", async () => {
    await page.goto(`${harness.baseUrl}/src/lib/viewport-harness.html`);
    await page.evaluate(() => {
        Object.defineProperty(window, "visualViewport", { configurable: true, get: () => undefined });
    });
    const threw = await page.evaluate(async () => {
        try {
            const modulePath = "/src/lib/viewport.svelte.ts";
            const mod = (await import(/* @vite-ignore */ modulePath)) as typeof ViewportModule;
            const unsubscribe = mod.trackViewport();
            unsubscribe();
            return false;
        } catch {
            return true;
        }
    });
    assert.equal(threw, false);
});

test("publishes --viewport-block and --keyboard-inset from visualViewport height", async () => {
    await loadWithStub(844, 844);
    assert.equal(await readProp("--viewport-block"), "844px");
    assert.equal(await readProp("--keyboard-inset"), "0px");
    assert.equal(await readDataset(), "closed");
});

test("a keyboard-sized inset sets data-keyboard to open above the threshold", async () => {
    // A 844px layout viewport shrunk to 380px by an open keyboard: a 464px inset, well past
    // the 120px threshold.
    await loadWithStub(844, 380);
    assert.equal(await readProp("--keyboard-inset"), "464px");
    assert.equal(await readDataset(), "open");
    const value = await page.evaluate(
        () => (window as unknown as { __keyboardOpen: { value: boolean } }).__keyboardOpen.value,
    );
    assert.equal(value, true);
});

test("an inset at or below the threshold stays closed", async () => {
    // 844 - 724 = 120, exactly the threshold; the rule is a strict greater-than.
    await loadWithStub(844, 724);
    assert.equal(await readProp("--keyboard-inset"), "120px");
    assert.equal(await readDataset(), "closed");
});

test("an inset one pixel past the threshold opens", async () => {
    await loadWithStub(844, 723);
    assert.equal(await readProp("--keyboard-inset"), "121px");
    assert.equal(await readDataset(), "open");
});

test("a transient negative inset is clamped to 0", async () => {
    // The visual viewport briefly reports taller than the layout viewport during a resize.
    await loadWithStub(844, 900);
    assert.equal(await readProp("--keyboard-inset"), "0px");
});

test("resize and scroll events on visualViewport re-run the update", async () => {
    await loadWithStub(844, 844);

    await page.evaluate(() => {
        const stub = (window as unknown as { __stubViewport: { height: number } }).__stubViewport;
        const listeners = (window as unknown as { __stubListeners: Map<string, Set<() => void>> })
            .__stubListeners;
        stub.height = 380;
        for (const fn of listeners.get("resize") ?? []) fn();
    });
    assert.equal(await readProp("--viewport-block"), "380px");
    assert.equal(await readDataset(), "open");

    await page.evaluate(() => {
        const stub = (window as unknown as { __stubViewport: { height: number } }).__stubViewport;
        const listeners = (window as unknown as { __stubListeners: Map<string, Set<() => void>> })
            .__stubListeners;
        stub.height = 844;
        for (const fn of listeners.get("scroll") ?? []) fn();
    });
    assert.equal(await readProp("--viewport-block"), "844px");
    assert.equal(await readDataset(), "closed");
});

test("unsubscribe stops further updates", async () => {
    await loadWithStub(844, 844);
    await page.evaluate(() => {
        (window as unknown as { __unsubscribe: () => void }).__unsubscribe();
        const stub = (window as unknown as { __stubViewport: { height: number } }).__stubViewport;
        const listeners = (window as unknown as { __stubListeners: Map<string, Set<() => void>> })
            .__stubListeners;
        stub.height = 380;
        for (const fn of listeners.get("resize") ?? []) fn();
    });
    // Still the value from the initial synchronous update() call, not 380: the listener was
    // removed by unsubscribe() before this resize fired.
    assert.equal(await readProp("--viewport-block"), "844px");
});
