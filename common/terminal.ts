export type TerminalKind = "command" | "follow" | "exec" | "host";

export interface Geometry {
    cols: number;
    rows: number;
}

export const GEOMETRY: Record<TerminalKind, Geometry> = {
    command: { cols: 105, rows: 8 },
    follow: { cols: 105, rows: 20 },
    exec: { cols: 105, rows: 24 },
    host: { cols: 105, rows: 40 },
};

export function composeTerminalName(endpoint: string, stack: string): string {
    return `compose-${endpoint}-${stack}`;
}

export function logsTerminalName(endpoint: string, stack: string): string {
    return `logs-${endpoint}-${stack}`;
}

export function execTerminalName(
    endpoint: string,
    stack: string,
    service: string,
    connId: string,
): string {
    return `exec-${endpoint}-${stack}-${service}-${connId}`;
}

export function hostShellName(connId: string): string {
    return `shell-${connId}`;
}

export const UPGRADE_TERMINAL = "upgrade";
