import type { Page, TestInfo } from "@playwright/test";
import {
    FINDINGS_ATTACHMENT,
    LEDGER_ATTACHMENT,
    type Finding,
    type LedgerReport,
} from "../../tools/audit/contract.ts";
import type { AuditRun, Violation } from "../../tools/audit/index.ts";
import type { Cell } from "./matrix.ts";

/** Context around the offending rect, so a crop shows what the element sits next to. */
const PADDING = 24;

interface Clip {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type Rect = Violation["highlight"];

function clipFor(rect: Rect, viewport: { width: number; height: number }): Clip | null {
    const left = Math.max(0, Math.floor(rect.x - PADDING));
    const top = Math.max(0, Math.floor(rect.y - PADDING));
    const right = Math.min(viewport.width, Math.ceil(rect.x + rect.width + PADDING));
    const bottom = Math.min(viewport.height, Math.ceil(rect.y + rect.height + PADDING));
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Outline the offending rect in the page before cropping. A crop with no marker leaves the reader
 * guessing which of the boxes in it is the one the message is about.
 */
async function withMarker<T>(page: Page, rect: Rect, body: () => Promise<T>): Promise<T> {
    const handle = await page.evaluateHandle((box: Rect) => {
        const marker = document.createElement("div");
        marker.style.cssText = [
            "position:fixed",
            `left:${box.x}px`,
            `top:${box.y}px`,
            `width:${Math.max(box.width, 1)}px`,
            `height:${Math.max(box.height, 1)}px`,
            "outline:2px solid #e5484d",
            "outline-offset:0",
            "pointer-events:none",
            "z-index:2147483647",
        ].join(";");
        document.body.append(marker);
        return marker;
    }, rect);
    try {
        return await body();
    } finally {
        await handle.evaluate((marker) => marker.remove());
        await handle.dispose();
    }
}

/** A cropped screenshot around a viewport rect, outlined, as a data URL. Null when it cannot be taken. */
export async function cropOf(page: Page, rect: Rect): Promise<string | null> {
    const viewport = page.viewportSize();
    if (viewport === null) return null;
    const clip = clipFor(rect, viewport);
    if (clip === null) return null;
    try {
        const png = await withMarker(page, rect, () => page.screenshot({ clip, animations: "disabled" }));
        return `data:image/png;base64,${png.toString("base64")}`;
    } catch {
        return null;
    }
}

export async function attachFindings(testInfo: TestInfo, findings: Finding[]): Promise<void> {
    if (findings.length === 0) return;
    await testInfo.attach(FINDINGS_ATTACHMENT, {
        body: JSON.stringify(findings),
        contentType: "application/json",
    });
}

/**
 * Attach this cell's violations and exemption ledger for the reporter to assemble. Screenshots are
 * taken here rather than in the reporter because the page is gone by the time the reporter runs.
 */
export async function attachRun(
    page: Page,
    testInfo: TestInfo,
    cell: Cell,
    run: AuditRun,
): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const violation of run.violations) {
        findings.push({
            cell: cell.id,
            screen: cell.screen,
            theme: cell.theme,
            width: cell.width,
            locale: cell.locale,
            scenario: cell.scenario,
            rule: violation.rule,
            severity: violation.severity,
            path: violation.path,
            message: violation.message,
            measured: String(violation.measured),
            expected: String(violation.expected),
            image: await cropOf(page, violation.highlight),
        });
    }

    await attachFindings(testInfo, findings);

    const ledger: LedgerReport = { cell: cell.id, entries: run.ledger };
    await testInfo.attach(LEDGER_ATTACHMENT, {
        body: JSON.stringify(ledger),
        contentType: "application/json",
    });

    return findings;
}
