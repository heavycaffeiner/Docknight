import type { ServiceInstance, StackDetail, StackSummary } from "../../../common/stack.ts";

// Defined locally rather than imported from backend/agent/methods.ts: pulling in that module
// drags its whole import graph into every consumer of the fixture data types, including tools
// that have no other reason to depend on the backend at all. The shape is small and stable.
export interface FixtureAgentSummary {
    url: string;
    endpoint: string;
    username: string;
    name: string;
}

export interface FixtureSettings {
    disableAuth: boolean;
    primaryHostname: string;
    checkUpdate: boolean;
    checkBeta: boolean;
    autoUpgrade: boolean;
    trustProxy: boolean;
    globalENV: string;
}

export interface FixtureDockerStat {
    Name: string;
    CPUPerc: string;
    MemUsage: string;
    MemPerc: string;
}

/** One canned world. No clock reads, no randomness: every field is a literal. */
export interface Scenario {
    settings: FixtureSettings;
    stacks: Record<string, StackSummary>;
    stackDetails: Record<string, StackDetail>;
    serviceStatus: Record<string, Record<string, ServiceInstance[]>>;
    stats: Record<string, FixtureDockerStat>;
    networks: string[];
    agents: Record<string, FixtureAgentSummary>;
    /** Per remote endpoint, keyed the same way as `stacks`. */
    agentStacks: Record<string, Record<string, StackSummary>>;
    terminalBuffer: string;
    /** Milliseconds of artificial delay before every response. 0 except the "slow" scenario. */
    latencyMs: number;
}

export type ScenarioName =
    | "typical"
    | "empty"
    | "single-stack"
    | "dense"
    | "extreme"
    | "degraded"
    | "slow";
