import { writeFileSync } from "node:fs";
import type { ExemptionUsageEntry } from "./index.ts";
import type { Violation } from "./rules/types.ts";

export interface CellResult {
    cellId: string;
    violations: Violation[];
    /** Base64 PNG, cropped to the violation's highlight rect, keyed by index into `violations`. */
    screenshots: (string | null)[];
    usage: ExemptionUsageEntry[];
}

export interface Report {
    cells: CellResult[];
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

interface Row {
    cellId: string;
    violation: Violation;
    screenshot: string | null;
}

function collectRows(report: Report): Row[] {
    const rows: Row[] = [];
    for (const cell of report.cells) {
        cell.violations.forEach((violation, i) => {
            rows.push({ cellId: cell.cellId, violation, screenshot: cell.screenshots[i] ?? null });
        });
    }
    return rows;
}

function summaryTable(rows: Row[]): string {
    const byRuleSeverity = new Map<string, number>();
    for (const row of rows) {
        const key = `${row.violation.rule}\t${row.violation.severity}`;
        byRuleSeverity.set(key, (byRuleSeverity.get(key) ?? 0) + 1);
    }
    const entries = [...byRuleSeverity.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const body = entries
        .map(([key, count]) => {
            const [rule, severity] = key.split("\t");
            return `<tr><td>${escapeHtml(rule ?? "")}</td><td>${escapeHtml(severity ?? "")}</td><td>${count}</td></tr>`;
        })
        .join("\n");
    return `<table><thead><tr><th>Rule</th><th>Severity</th><th>Count</th></tr></thead><tbody>${body || '<tr><td colspan="3">No violations</td></tr>'}</tbody></table>`;
}

function violationRows(rows: Row[]): string {
    if (rows.length === 0) return "<p>None.</p>";
    return rows
        .map((row) => {
            const img =
                row.screenshot === null
                    ? ""
                    : `<img src="data:image/png;base64,${row.screenshot}" alt="cropped violation region" />`;
            return `<div class="violation ${escapeHtml(row.violation.severity)}">
    <h3>${escapeHtml(row.violation.rule)} — ${escapeHtml(row.cellId)}</h3>
    <p class="path"><code>${escapeHtml(row.violation.path)}</code></p>
    <p>${escapeHtml(row.violation.message)}</p>
    <p>measured: <code>${escapeHtml(String(row.violation.measured))}</code>, expected: <code>${escapeHtml(String(row.violation.expected))}</code></p>
    ${img}
</div>`;
        })
        .join("\n");
}

function exemptionLedger(report: Report): string {
    const byId = new Map<string, { rule: string; total: number; stale: boolean }>();
    for (const cell of report.cells) {
        for (const entry of cell.usage) {
            const existing = byId.get(entry.id) ?? { rule: entry.rule, total: 0, stale: true };
            existing.total += entry.matchCount;
            if (entry.matchCount > 0) existing.stale = false;
            byId.set(entry.id, existing);
        }
    }
    const body = [...byId.entries()]
        .map(
            ([id, { rule, total, stale }]) =>
                `<tr><td>${escapeHtml(id)}</td><td>${escapeHtml(rule)}</td><td>${total}</td><td>${stale ? "stale" : "active"}</td></tr>`,
        )
        .join("\n");
    return `<table><thead><tr><th>Exemption</th><th>Rule</th><th>Total matches</th><th>Status</th></tr></thead><tbody>${body || '<tr><td colspan="4">No exemptions</td></tr>'}</tbody></table>`;
}

/**
 * Render a single self-contained verification-report.html: a summary table by rule and
 * severity, one entry per violation with its cropped screenshot, the exemption ledger, and the
 * list of elements the contrast rule flagged as contrast-unknown (a warning, not an error, so
 * it is always visible in the report without ever failing the run on its own).
 */
export function renderReport(report: Report): string {
    const rows = collectRows(report);
    const errorRows = rows.filter((r) => r.violation.severity === "error");
    const warningRows = rows.filter((r) => r.violation.severity === "warning");
    const contrastUnknownRows = warningRows.filter((r) => r.violation.message.startsWith("contrast-unknown"));

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Docknight verification report</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
table { border-collapse: collapse; margin-block-end: 1.5rem; }
th, td { border: 1px solid #ccc; padding: 0.4rem 0.8rem; text-align: left; }
.violation { border: 1px solid #ccc; border-radius: 4px; padding: 0.75rem 1rem; margin-block-end: 0.75rem; }
.violation.error { border-inline-start: 4px solid #c0392b; }
.violation.warning { border-inline-start: 4px solid #d4a017; }
.violation img { max-width: 400px; display: block; margin-block-start: 0.5rem; border: 1px solid #ccc; }
.path code { background: #f0f0f0; padding: 0.1rem 0.3rem; }
h1 { margin-block-end: 0.25rem; }
h2 { margin-block-start: 2rem; }
</style>
</head>
<body>
<h1>Docknight verification report</h1>
<p>${report.cells.length} cells audited, ${errorRows.length} error(s), ${warningRows.length} warning(s).</p>

<h2>Summary</h2>
${summaryTable(rows)}

<h2>Exemption ledger</h2>
${exemptionLedger(report)}

<h2>Errors</h2>
${violationRows(errorRows)}

<h2>Warnings, including contrast-unknown (${contrastUnknownRows.length})</h2>
${violationRows(warningRows)}
</body>
</html>
`;
}

export function writeReport(report: Report, path: string): void {
    writeFileSync(path, renderReport(report), "utf8");
}
