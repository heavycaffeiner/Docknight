import { expect, test } from "@playwright/test";
import { openCell, settlePage } from "../support/harness.ts";
import { layoutMatrix } from "../support/matrix.ts";

/** The extreme scenario replays a buffer deeper than the pane, so there is history to reach. */
const cell = layoutMatrix().find((candidate) => candidate.id === "console.light.360.extreme");

interface DragResult {
    atBottom: string;
    afterDragBack: string;
    afterDragForward: string;
    claimedWithRoom: boolean;
    claimedAtTop: boolean;
    atTop: string;
}

test("a drag reaches the terminal scrollback and releases the page at its end", async ({ page }) => {
    if (cell === undefined) throw new Error("no extreme console cell in the matrix");
    await openCell(page, cell);
    await settlePage(page);

    const result = await page.evaluate<DragResult>(async () => {
        const surface = document.querySelector<HTMLElement>("[data-audit-id='terminal-surface']");
        const rows = surface?.querySelector<HTMLElement>(".xterm-rows") ?? null;
        if (surface === null || rows === null) throw new Error("no rendered terminal");

        // xterm repaints on a frame, so the rows are read only once it has had one.
        const painted = async (): Promise<string> => {
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
            return rows.textContent ?? "";
        };

        const touch = (type: string, clientY: number): boolean => {
            const event = new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches:
                    type === "touchend"
                        ? []
                        : [new Touch({ identifier: 1, target: surface, clientY, clientX: 10 })],
            });
            // dispatchEvent returns false when a listener cancelled it, which is what stops the
            // page from taking the gesture.
            return !surface.dispatchEvent(event);
        };

        const drag = (from: number, to: number): boolean => {
            touch("touchstart", from);
            let claimed = false;
            const step = from < to ? 12 : -12;
            for (let y = from + step; step > 0 ? y <= to : y >= to; y += step) {
                claimed = touch("touchmove", y) || claimed;
            }
            touch("touchend", to);
            return claimed;
        };

        const atBottom = await painted();
        // Dragging the finger down walks back towards older output.
        const claimedWithRoom = drag(100, 400);
        const afterDragBack = await painted();

        // At the very top there is nothing older left, so the page must get the gesture.
        drag(100, 4000);
        const atTop = await painted();
        const claimedAtTop = drag(100, 400);

        // Dragging up returns towards the newest output.
        drag(400, 100);
        drag(400, 100);
        drag(400, 100);
        const afterDragForward = await painted();

        return {
            atBottom,
            afterDragBack,
            afterDragForward,
            claimedWithRoom,
            claimedAtTop,
            atTop,
        };
    });

    expect(result.claimedWithRoom).toBe(true);
    expect(result.afterDragBack).not.toBe(result.atBottom);
    // A long drag walks the whole buffer rather than crawling a line per gesture.
    expect(result.atTop).toContain("line 0000");
    expect(result.claimedAtTop).toBe(false);
    expect(result.afterDragForward).not.toBe(result.afterDragBack);
});
