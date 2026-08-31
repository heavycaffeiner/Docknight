import { test, expect } from "@playwright/test";
import { cells } from "../support/matrix.ts";
import {
    closeAllScenarioServers,
    openCell,
    runAuditWithUsage,
    screenshotHighlight,
} from "../support/harness.ts";
import type { CellResult } from "../../tools/audit/report.ts";
import { writeReport } from "../../tools/audit/report.ts";

const REPORT_PATH = new URL("../../verification-report.html", import.meta.url).pathname;

// Collected across every test in this file (Playwright runs one file per worker process, so
// each worker's own module instance accumulates only the cells that worker actually ran) and
// merged into one report file in a single afterAll, uploaded whether the run passed or failed.
const results: CellResult[] = [];

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

            const { violations, usage } = await runAuditWithUsage(opened, cell);
            const failures = violations.filter((v) => v.severity === "error");

            const screenshots = await Promise.all(
                violations.map((v) => screenshotHighlight(opened, v.highlight)),
            );
            results.push({ cellId: cell.id, violations, screenshots, usage });

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
    // Sharded or parallel worker processes each hold their own slice of `results`; Playwright
    // has no built-in cross-worker merge step, so each worker writes to the same path and the
    // last one to finish wins. A single local run (the common case, and the only one CI does
    // without a merge-reports step of its own) always gets one process and one full report.
    writeReport({ cells: results }, REPORT_PATH);
});
