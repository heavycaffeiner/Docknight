import { on } from "../connection.svelte.ts";
import { dropEndpoint } from "./stacks.svelte.ts";

export interface AgentSummary {
    url: string;
    endpoint: string;
    username: string;
    name: string;
}

export interface AgentStatusPayload {
    endpoint: string;
    status: "connecting" | "online" | "offline";
    message?: string;
}

const state = $state<{
    byEndpoint: Record<string, AgentSummary>;
    statuses: Record<string, AgentStatusPayload>;
}>({ byEndpoint: {}, statuses: {} });

export const agents: {
    readonly byEndpoint: Record<string, AgentSummary>;
    readonly statuses: Record<string, AgentStatusPayload>;
} = {
    get byEndpoint() {
        return state.byEndpoint;
    },
    get statuses() {
        return state.statuses;
    },
};

export function resetAgentsStore(): void {
    state.byEndpoint = {};
    state.statuses = {};
}

on("agentList", (_endpoint, data) => {
    const payload = data as { agents: Record<string, AgentSummary> };
    const removed = Object.keys(state.byEndpoint).filter((endpoint) => !(endpoint in payload.agents));
    state.byEndpoint = payload.agents;
    // invariant: this is the only path that removes an endpoint's stacks.
    for (const endpoint of removed) dropEndpoint(endpoint);
});

on("agentStatus", (_endpoint, data) => {
    const payload = data as AgentStatusPayload;
    state.statuses = { ...state.statuses, [payload.endpoint]: payload };
});
