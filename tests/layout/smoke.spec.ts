import { test, expect } from "@playwright/test";
import { cells } from "../support/matrix.ts";
import { closeAllScenarioServers, openCell } from "../support/harness.ts";

/**
 * Every cell in the geometry x theme x locale x scenario matrix, checked for the two things
 * that matter before phase 10 supplies the real auditor rules: the screen reaches its target
 * without a console error, and the document never overflows its own viewport width. This is
 * what makes the matrix itself, geometry and all, part of CI from this phase on.
 */
for (const cell of cells()) {
    test(cell.id, async () => {
        const errors: string[] = [];
        const opened = await openCell(cell);
        try {
            opened.page.on("pageerror", (error) => errors.push(String(error)));
            opened.page.on("console", (msg) => {
                if (msg.type() === "error") errors.push(msg.text());
            });

            const overflow = await opened.page.evaluate(() => {
                const el = document.scrollingElement;
                return el === null ? 0 : el.scrollWidth - window.innerWidth;
            });

            expect(errors, `console/page errors on ${cell.id}`).toEqual([]);
            expect(overflow, `horizontal overflow on ${cell.id}`).toBeLessThanOrEqual(1);
        } finally {
            await opened.done();
        }
    });
}

test.afterAll(async () => {
    await closeAllScenarioServers();
});
