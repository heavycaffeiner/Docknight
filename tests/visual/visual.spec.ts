import { expect, test } from "@playwright/test";
import { openCell, settlePage } from "../support/harness.ts";
import { visualMatrix } from "../support/matrix.ts";

/**
 * Byte comparison is only meaningful against the font stack and renderer the baselines were taken
 * with, so outside the pinned image this project reports rather than gates.
 */
const PINNED = process.env.DOCKNIGHT_VERIFY_IMAGE === "1";

test.describe(() => {
    test.skip(!PINNED, "screenshots are compared only inside the pinned verification image");

    for (const cell of visualMatrix()) {
        test(cell.id, async ({ page }) => {
            await openCell(page, cell);
            await settlePage(page);

            await expect(page).toHaveScreenshot(`${cell.screen}.${cell.theme}.${cell.width}.png`, {
                fullPage: true,
                animations: "disabled",
                caret: "hide",
                // Clocks, statistics and log tails change between runs and are not what this checks.
                mask: [page.locator("[data-audit-volatile]")],
                maxDiffPixelRatio: 0.001,
                threshold: 0.15,
            });
        });
    }
});
