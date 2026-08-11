import { expect, test } from "@playwright/test";
import { openCell, settlePage } from "../support/harness.ts";
import { layoutMatrix } from "../support/matrix.ts";

/**
 * Playwright never opens a keyboard, so the `keyboard` cell of the matrix exercises the layout a
 * shrunk viewport produces and not the path that shrinks it. The Safari branch, where the layout
 * viewport keeps its full height and only the visual one moves, is driven here against a stubbed
 * `visualViewport` instead.
 */
/** The Dashboard rather than a stack: a screen carrying its own bottom app bar has already given
    up the navigation bar, so it cannot show that a keyboard is what took it. */
const cell = layoutMatrix().find((candidate) => candidate.id === "dashboard.light.phone");

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

/** Roughly what an iOS keyboard takes on a 390x844 phone. */
const KEYBOARD = 336;

interface Shell {
    inset: string;
    keyboard: string | null;
    rail: string;
    height: number;
}

test("the shell gives its height back to the page when a keyboard opens", async ({ page }) => {
    if (cell === undefined) throw new Error("no phone dashboard cell in the matrix");

    await page.addInitScript(() => {
        const events = new EventTarget();
        const stub = {
            height: window.innerHeight,
            offsetTop: 0,
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
        };
        Object.defineProperty(window, "visualViewport", { value: stub, configurable: true });
        Object.defineProperty(window, "__resizeVisual", {
            value: (height: number) => {
                stub.height = height;
                events.dispatchEvent(new Event("resize"));
            },
            configurable: true,
        });
    });

    await openCell(page, cell);
    await settlePage(page);

    const read = async (): Promise<Shell> =>
        await page.evaluate(() => {
            const root = document.documentElement;
            const rail = document.querySelector("[data-audit-id='nav-rail']");
            const shell = document.querySelector("[data-audit-root]");
            return {
                inset: getComputedStyle(root).getPropertyValue("--keyboard-inset").trim(),
                keyboard: root.dataset.keyboard ?? null,
                rail: rail === null ? "absent" : getComputedStyle(rail).display,
                height: shell === null ? 0 : shell.getBoundingClientRect().height,
            };
        });

    const closed = await read();
    expect(closed.inset).toBe("0px");
    expect(closed.keyboard).toBeNull();
    expect(closed.rail).not.toBe("none");
    expect(closed.height).toBe(844);

    await page.evaluate((taken: number) => {
        (window as unknown as { __resizeVisual: (height: number) => void }).__resizeVisual(
            window.innerHeight - taken,
        );
    }, KEYBOARD);
    await settlePage(page);

    const opened = await read();
    expect(opened.inset).toBe(`${KEYBOARD}px`);
    expect(opened.keyboard).toBe("open");
    // Navigation is not the task while a field is being typed into, and a bar behind a keyboard is
    // one the reader cannot dismiss.
    expect(opened.rail).toBe("none");
    expect(opened.height).toBe(844 - KEYBOARD);
});
