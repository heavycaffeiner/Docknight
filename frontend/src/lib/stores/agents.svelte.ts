import type { AgentStatus, AgentSummary } from "$common/protocol.ts";

export interface AgentEntry extends AgentSummary {
    status: AgentStatus;
    message?: string;
}

/** Keyed by endpoint. The local host is always present under the empty string. */
export const agents = $state<{ byEndpoint: Record<string, AgentEntry>; loaded: boolean }>({
    byEndpoint: { "": { url: "", endpoint: "", username: "", name: "", status: "online" } },
    loaded: false,
});

export function applyAgentList(list: Record<string, AgentSummary>): void {
    const next: Record<string, AgentEntry> = {};
    for (const [endpoint, summary] of Object.entries(list)) {
        const previous = agents.byEndpoint[endpoint];
        next[endpoint] = {
            ...summary,
            status: endpoint === "" ? "online" : (previous?.status ?? "connecting"),
            ...(previous?.message === undefined ? {} : { message: previous.message }),
        };
    }
    if (next[""] === undefined) {
        next[""] = { url: "", endpoint: "", username: "", name: "", status: "online" };
    }
    agents.byEndpoint = next;
    agents.loaded = true;
}

export function applyAgentStatus(endpoint: string, status: AgentStatus, message?: string): void {
    const existing = agents.byEndpoint[endpoint];
    if (existing === undefined) return;
    agents.byEndpoint = {
        ...agents.byEndpoint,
        [endpoint]: { ...existing, status, ...(message === undefined ? {} : { message }) },
    };
}

export function clearAgents(): void {
    agents.byEndpoint = { "": { url: "", endpoint: "", username: "", name: "", status: "online" } };
    agents.loaded = false;
}

/** Configured remote hosts, excluding the local entry. */
export function remoteAgents(): AgentEntry[] {
    return Object.values(agents.byEndpoint)
        .filter((agent) => agent.endpoint !== "")
        .sort((a, b) => (a.name || a.endpoint).localeCompare(b.name || b.endpoint));
}

export function endpointLabel(endpoint: string): string {
    if (endpoint === "") return "";
    const agent = agents.byEndpoint[endpoint];
    return agent === undefined || agent.name === "" ? endpoint : agent.name;
}

/** Group headers are not rendered at all with exactly one host. */
export function hasMultipleHosts(): boolean {
    return Object.keys(agents.byEndpoint).length > 1;
}
