import { expect, test } from "@playwright/test";
import { openCell, settlePage } from "../support/harness.ts";
import { layoutMatrix } from "../support/matrix.ts";

const cell = layoutMatrix().find((candidate) => candidate.id === "console.light.360");

test("a drag scrolls the terminal back through its buffer", async ({ page }) => {
    if (cell === undefined) throw new Error("no console cell in the matrix");
    await openCell(page, cell);
    await settlePage(page);

    const result = await page.evaluate(() => {
        const surface = document.querySelector<HTMLElement>("[data-audit-id='terminal-surface']");
        const viewport = surface?.querySelector<HTMLElement>(".xterm-viewport") ?? null;
        if (surface === null || viewport === null) throw new Error("no terminal viewport");

        // The fixture writes a handful of lines, so the scroller is given something to scroll.
        const spacer = document.createElement("div");
        spacer.style.blockSize = "2000px";
        viewport.append(spacer);

        viewport.scrollTop = viewport.scrollHeight;
        const scrollable = viewport.scrollHeight - viewport.clientHeight;
        const bottom = viewport.scrollTop;

        const touch = (type: string, clientY: number): boolean => {
            const event = new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches:
                    type === "touchend"
                        ? []
                        : [new Touch({ identifier: 1, target: surface, clientY, clientX: 10 })],
            });
            return !surface.dispatchEvent(event);
        };

        // Dragging down reads as going back towards older output.
        touch("touchstart", 100);
        const consumed = touch("touchmove", 160);
        const afterDrag = viewport.scrollTop;
        touch("touchend", 160);

        // At the top the pane has nowhere left to go, so the page must keep the gesture.
        viewport.scrollTop = 0;
        touch("touchstart", 100);
        const consumedAtTop = touch("touchmove", 160);
        touch("touchend", 160);

        return { scrollable, bottom, afterDrag, consumed, consumedAtTop };
    });

    expect(result.scrollable).toBeGreaterThan(0);
    expect(result.afterDrag).toBe(result.bottom - 60);
    expect(result.consumed).toBe(true);
    expect(result.consumedAtTop).toBe(false);
});
