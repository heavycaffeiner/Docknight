import { test, expect } from "@playwright/test";
import { a11yCells } from "../support/matrix.ts";
import { closeAllScenarioServers, openCell, runAxe } from "../support/harness.ts";

/**
 * axe-core's own WCAG 2.1 AA rule set against every screen at phone and laptop, both themes.
 * Deliberately overlaps the auditor's own contrast and target-size rules (proposal 8 4.3.7):
 * axe is authoritative for the checks it implements, the auditor's versions report measured
 * values in the same shape as every other rule. Only serious and critical impact gate the run;
 * moderate and minor are recorded in the failure message but do not fail the test.
 */
for (const cell of a11yCells()) {
    test(cell.id, async () => {
        const opened = await openCell(cell);
        try {
            const violations = await runAxe(opened);
            const gating = violations.filter((v) => v.impact === "serious" || v.impact === "critical");

            expect(
                gating,
                `axe violations (serious+) on ${cell.id}:\n${gating
                    .map((v) => `  ${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).join("\n    ")}`)
                    .join("\n")}`,
            ).toEqual([]);
        } finally {
            await opened.done();
        }
    });
}

test.afterAll(async () => {
    await closeAllScenarioServers();
});
