import { test, expect } from "@playwright/test";
import { cells } from "../support/matrix.ts";
import { closeAllScenarioServers, openCell, runAudit } from "../support/harness.ts";

/**
 * Every cell in the geometry x theme x locale x scenario matrix, run through the real auditor
 * (tools/audit): the same rule modules the dev overlay imports, so there is exactly one
 * implementation of every rule. A cell also fails on any console or page error, and `reflow`
 * cells (rules: ["overflow"]) skip every rule but the one WCAG 1.4.10 is actually about.
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

            const violations = await runAudit(opened, cell);
            const failures = violations.filter((v) => v.severity === "error");

            expect(errors, `console/page errors on ${cell.id}`).toEqual([]);
            expect(
                failures,
                `design rule violations on ${cell.id}:\n${failures.map((v) => `  ${v.rule} ${v.path}: ${v.message}`).join("\n")}`,
            ).toEqual([]);
        } finally {
            await opened.done();
        }
    });
}

test.afterAll(async () => {
    await closeAllScenarioServers();
});
