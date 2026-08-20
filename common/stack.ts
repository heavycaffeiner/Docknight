export const UNKNOWN = 0;
export const DRAFT = 1;
export const CREATED = 2;
export const RUNNING = 3;
export const EXITED = 4;

export interface StackSummary {
    name: string;
    status: number;
    /** Whether the directory exists under stacksDir. */
    managed: boolean;
    composeFileName: string;
}

export interface StackDetail extends StackSummary {
    composeYAML: string;
    composeENV: string;
    /** For building service URLs in the UI. */
    primaryHostname: string;
}

export interface ServiceInstance {
    name: string;
    status: string;
}

/** Interpret one `docker compose ls` status string, e.g. "exited(1), running(2)". */
export function convertStatus(text: string): number {
    const lower = text.toLowerCase();
    if (lower.startsWith("created")) return CREATED;
    if (lower.includes("exited")) return EXITED;
    if (lower.startsWith("running")) return RUNNING;
    return UNKNOWN;
}
