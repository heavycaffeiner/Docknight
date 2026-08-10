export type TerminalKind = "command" | "follow" | "exec" | "host";

export interface Geometry {
    cols: number;
    rows: number;
}

/**
 * Row counts are chosen so each pane's rendered height lands on the 4 pixel grid: the mono
 * line height is 20px, so these are 160, 400, 480 and 800 pixels.
 */
export const COMMAND_GEOMETRY: Geometry = { cols: 105, rows: 8 };
export const FOLLOW_GEOMETRY: Geometry = { cols: 105, rows: 20 };
export const EXEC_GEOMETRY: Geometry = { cols: 105, rows: 24 };
export const HOST_GEOMETRY: Geometry = { cols: 105, rows: 40 };

export const MIN_COLS = 20;
export const MAX_COLS = 500;
export const MIN_ROWS = 5;
export const MAX_ROWS = 200;

/** Turning an arbitrary string into one of four known values is the whole point of the list. */
export const ALLOWED_SHELLS = ["sh", "bash", "ash", "zsh"] as const;
export type AllowedShell = (typeof ALLOWED_SHELLS)[number];

export function isAllowedShell(value: string): value is AllowedShell {
    return (ALLOWED_SHELLS as readonly string[]).includes(value);
}

/** Progress output of one compose command. One per stack; the operation lock keeps it single. */
export function commandTerminalName(endpoint: string, stack: string): string {
    return `compose-${endpoint}-${stack}`;
}

/** Combined follow-log of one stack, shared by every viewer. */
export function followTerminalName(endpoint: string, stack: string): string {
    return `logs-${endpoint}-${stack}`;
}

/** Keyed on the connection, so two browser tabs get two independent shells. */
export function execTerminalName(
    endpoint: string,
    stack: string,
    service: string,
    connectionId: string,
): string {
    return `exec-${endpoint}-${stack}-${service}-${connectionId}`;
}

/** One host shell per connection. */
export function hostTerminalName(connectionId: string): string {
    return `shell-${connectionId}`;
}

export function geometryFor(kind: TerminalKind): Geometry {
    switch (kind) {
        case "command":
            return COMMAND_GEOMETRY;
        case "follow":
            return FOLLOW_GEOMETRY;
        case "exec":
            return EXEC_GEOMETRY;
        case "host":
            return HOST_GEOMETRY;
    }
}

export function clampCols(value: number): number {
    return Math.min(MAX_COLS, Math.max(MIN_COLS, Math.trunc(value)));
}

export function clampRows(value: number): number {
    return Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.trunc(value)));
}
