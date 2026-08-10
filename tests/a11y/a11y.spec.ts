import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import type { AxeResults, ImpactValue, Result } from "axe-core";
import type { Finding } from "../../tools/audit/contract.ts";
import { attachFindings, cropOf } from "../support/findings.ts";
import { armKeyboardModality, openCell, settlePage } from "../support/harness.ts";
import { accessibilityMatrix, type Cell } from "../support/matrix.ts";

const AXE_BUNDLE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Impacts that fail the run. `moderate` and `minor` are reported and left to judgement. */
const GATING: ReadonlySet<ImpactValue> = new Set<ImpactValue>(["serious", "critical"]);

function severityOf(impact: ImpactValue | null | undefined): Finding["severity"] {
    return impact !== null && impact !== undefined && GATING.has(impact) ? "error" : "warning";
}

async function findingsOf(page: Page, cell: Cell, results: Result[]): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const result of results) {
        for (const node of result.nodes) {
            const selector = node.target.map((part) => String(part)).join(" ");
            const rect = await page
                .locator(selector)
                .first()
                .boundingBox()
                .catch(() => null);
            findings.push({
                cell: cell.id,
                screen: cell.screen,
                theme: cell.theme,
                width: cell.width,
                locale: cell.locale,
                scenario: cell.scenario,
                rule: `axe/${result.id}`,
                severity: severityOf(node.impact ?? result.impact),
                path: selector,
                message: node.failureSummary ?? result.help,
                measured: node.html.slice(0, 200),
                expected: result.help,
                image: rect === null ? null : await cropOf(page, rect),
            });
        }
    }
    return findings;
}

for (const cell of accessibilityMatrix()) {
    test(cell.id, async ({ page }) => {
        await openCell(page, cell);
        await armKeyboardModality(page);
        await settlePage(page);

        await page.addScriptTag({ path: AXE_BUNDLE });
        const results = await page.evaluate(async (tags: string[]) => {
            const host = globalThis as unknown as {
                axe?: { run(context: unknown, options: unknown): Promise<AxeResults> };
            };
            if (host.axe === undefined) throw new Error("axe-core did not load");
            return await host.axe.run(document, { runOnly: { type: "tag", values: tags } });
        }, TAGS);

        const findings = await findingsOf(page, cell, results.violations);
        await attachFindings(test.info(), findings);

        const gating = findings.filter((finding) => finding.severity === "error");
        expect(gating.map((finding) => `${finding.rule} at ${finding.path}`)).toEqual([]);
    });
}
