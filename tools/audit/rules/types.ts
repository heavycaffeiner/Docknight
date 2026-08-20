export interface Measured {
    node: Element;
    /** Path of data-audit-id values from the audit root, for stable reporting. */
    path: string;
    rect: DOMRect;
    style: CSSStyleDeclaration;
}

export interface Violation {
    rule: string;
    severity: "error" | "warning";
    path: string;
    /** Human-readable statement of what was measured, in English. */
    message: string;
    measured: number | string;
    expected: number | string;
    /** Viewport rect to crop for the report screenshot. */
    highlight: { x: number; y: number; width: number; height: number };
}

export interface Exemption {
    id: string;
    rule: string;
    selector: string;
    reason: string;
    maxMatches: number;
    approvedBy: string;
    approvedOn: string;
}

export interface AuditOptions {
    /** Grid base unit in CSS pixels. 4 for this project. */
    unit: number;
    /** Absolute tolerance in CSS pixels applied to every geometric comparison. */
    tolerance: number;
    /** Whether the cell emulates a coarse pointer; selects target-size vs touch-target. */
    coarsePointer: boolean;
    /** Parsed design/exemptions.json. */
    exemptions: Exemption[];
    /** Rule names to skip for this cell, for example everything but overflow at reflow. */
    skip?: string[];
}

export interface Rule {
    name: string;
    /**
     * Rules run in declaration order. A rule that focuses or otherwise mutates the page sets
     * `mutates` and is deferred until every measuring rule is done.
     */
    mutates?: boolean;
    check(nodes: Measured[], options: AuditOptions): Violation[];
}
