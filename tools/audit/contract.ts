/**
 * Shapes crossing between the in-page auditor and the Node tooling that reads its output. Nothing
 * here may name a DOM type, because the loader and the reporter compile without the DOM library.
 */

export type Severity = "error" | "warning";

/** One entry of design/exemptions.json. */
export interface Exemption {
    id: string;
    rule: string;
    /** Always of the form [data-audit-id='...']; anything else is rejected by the loader. */
    selector: string;
    reason: string;
    maxMatches: number;
    approvedBy: string;
    approvedOn: string;
}

/** One exemption entry and how much it actually silenced during one audit. */
export interface LedgerEntry {
    id: string;
    rule: string;
    matches: number;
    exceeded: boolean;
}

export const FINDINGS_ATTACHMENT = "docknight/findings";
export const LEDGER_ATTACHMENT = "docknight/ledger";

/** One violation, flattened with its matrix cell and a crop of the offending rect. */
export interface Finding {
    cell: string;
    screen: string;
    theme: string;
    width: number;
    locale: string;
    scenario: string;
    rule: string;
    severity: Severity;
    path: string;
    message: string;
    measured: string;
    expected: string;
    /** Data URL of the cropped region, or null when the rect could not be captured. */
    image: string | null;
}

export interface LedgerReport {
    cell: string;
    entries: LedgerEntry[];
}
