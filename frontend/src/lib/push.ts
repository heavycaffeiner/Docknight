import type { StackSummary } from "../../../common/stack.ts";
import { createStore } from "./store.ts";
import { on } from "./transport.ts";

/**
 * Server-pushed state. These four payloads arrive unsolicited over the socket, so they are not
 * React Query resources: there is no fetch to key them by. Everything request-and-response
 * lives in React Query instead.
 */

export interface AgentSummary {
    endpoint: string;
    url: string;
    username: string;
    name?: string;
}

export type AgentStatusValue = "online" | "offline" | "unreachable" | "connecting";

export interface AgentStatus {
    endpoint: string;
    status: AgentStatusValue;
    message?: string;
}

export interface StacksState {
    /** Keyed `"<stack name> <endpoint>"`; the local host is the empty endpoint. */
    byKey: Record<string, StackSummary>;
    loaded: boolean;
}

export interface AgentsState {
    byEndpoint: Record<string, AgentSummary>;
    statuses: Record<string, AgentStatus>;
}

export interface ServerInfo {
    version?: string;
    latestVersion?: string | null;
    protocolVersion?: number;
    isContainer?: boolean;
    primaryHostname?: string;
}

export const stacks = createStore<StacksState>({ byKey: {}, loaded: false });
export const agents = createStore<AgentsState>({ byEndpoint: {}, statuses: {} });
export const serverInfo = createStore<ServerInfo>({});

export function stackKey(name: string, endpoint: string): string {
    return `${name} ${endpoint}`;
}

export function splitStackKey(key: string): { name: string; endpoint: string } {
    const at = key.lastIndexOf(" ");
    if (at === -1) return { name: key, endpoint: "" };
    return { name: key.slice(0, at), endpoint: key.slice(at + 1) };
}

function withoutEndpoint(
    byKey: Record<string, StackSummary>,
    endpoint: string,
): Record<string, StackSummary> {
    const next: Record<string, StackSummary> = {};
    for (const [key, value] of Object.entries(byKey)) {
        if (splitStackKey(key).endpoint !== endpoint) next[key] = value;
    }
    return next;
}

export function clearPushState(): void {
    stacks.set({ byKey: {}, loaded: false });
    agents.set({ byEndpoint: {}, statuses: {} });
}

on("stackList", (payload: unknown, endpoint: string) => {
    const data = payload as { stacks?: Record<string, StackSummary> } | undefined;
    if (data?.stacks === undefined) return;
    stacks.update((current) => {
        const byKey = withoutEndpoint(current.byKey, endpoint);
        for (const [name, summary] of Object.entries(data.stacks ?? {})) {
            byKey[stackKey(name, endpoint)] = summary;
        }
        return { byKey, loaded: true };
    });
});

on("agentList", (payload: unknown) => {
    const data = payload as { agents?: Record<string, AgentSummary> } | undefined;
    if (data?.agents === undefined) return;
    // The empty endpoint is the reserved label for this host, never a remote agent. A payload
    // that carries it anyway would otherwise produce a second, nameless host everywhere.
    const next = Object.fromEntries(
        Object.entries(data.agents).filter(([endpoint]) => endpoint !== ""),
    );
    stacks.update((current) => {
        let byKey = current.byKey;
        for (const endpoint of Object.keys(current.byKey).map((k) => splitStackKey(k).endpoint)) {
            if (endpoint !== "" && next[endpoint] === undefined) {
                byKey = withoutEndpoint(byKey, endpoint);
            }
        }
        return byKey === current.byKey ? current : { ...current, byKey };
    });
    agents.update((current) => ({ ...current, byEndpoint: next }));
});

on("agentStatus", (payload: unknown, endpoint: string) => {
    const data = payload as AgentStatus | undefined;
    const ep = data?.endpoint || endpoint;
    if (ep === "") return;
    agents.update((current) => ({
        ...current,
        statuses: {
            ...current.statuses,
            [ep]: { status: data?.status ?? "offline", message: data?.message, endpoint: ep },
        },
    }));
});

on("info", (payload: unknown) => {
    const data = payload as ServerInfo | undefined;
    if (data === undefined) return;
    serverInfo.update((current) => ({ ...current, ...data }));
});
