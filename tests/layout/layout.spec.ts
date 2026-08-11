import { expect, test } from "@playwright/test";
import { loadExemptions } from "../../tools/audit/exemptions.ts";
import type { Exemption } from "../../tools/audit/contract.ts";
import { attachRun } from "../support/findings.ts";
import { armKeyboardModality, openCell, runAudit } from "../support/harness.ts";
import { layoutMatrix } from "../support/matrix.ts";

let exemptions: Exemption[] = [];

test.beforeAll(async () => {
    exemptions = await loadExemptions();
});

// The touch flag is a context option rather than a page one, so a cell that emulates a touchscreen
// has to declare it before its page exists. That is what makes `pointer: coarse` match, and the
// density and target rules are asserted rather than assumed because of it.
for (const cell of layoutMatrix()) {
    test.describe(cell.id, () => {
        test.use({
            viewport: { width: cell.width, height: cell.height },
            hasTouch: cell.touch,
        });

        test("layout", async ({ page }) => {
            await openCell(page, cell);
            await armKeyboardModality(page);

            const run = await runAudit(page, cell, exemptions);
            const findings = await attachRun(page, test.info(), cell, run);

            const errors = findings.filter((finding) => finding.severity === "error");
            expect(
                errors.map((finding) => `${finding.rule} at ${finding.path}: ${finding.message}`),
            ).toEqual([]);
        });
    });
}
