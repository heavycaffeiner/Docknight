import { on } from "../connection.svelte.ts";
import { dropEndpoint } from "./stacks.svelte.ts";

export interface AgentSummary {
    endpoint: string;
    url: string;
    username: string;
    name?: string;
}

export interface AgentStatus {
    endpoint: string;
    status: "online" | "offline" | "unreachable" | "connecting";
}

export interface AgentsStore {
    byEndpoint: Record<string, AgentSummary>;
    statuses: Record<string, AgentStatus>;
}

export const agents = $state<AgentsStore>({
    byEndpoint: {},
    statuses: {},
});

export function clearAgents(): void {
    agents.byEndpoint = {};
    agents.statuses = {};
}

on("agentList", (payload: unknown) => {
    const data = payload as { agents?: Record<string, AgentSummary> } | undefined;
    if (data?.agents === undefined) return;
    const oldEndpoints = Object.keys(agents.byEndpoint);
    const newEndpoints = new Set(Object.keys(data.agents));
    for (const ep of oldEndpoints) {
        if (!newEndpoints.has(ep)) {
            dropEndpoint(ep);
        }
    }
    agents.byEndpoint = data.agents;
});

on("agentStatus", (payload: unknown, endpoint: string) => {
    const data = payload as AgentStatus | undefined;
    const ep = data?.endpoint || endpoint;
    if (ep !== "") {
        agents.statuses[ep] = { ...(data ?? { status: "offline" }), endpoint: ep };
    }
});
