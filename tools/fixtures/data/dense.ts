import { RUNNING } from "../../../common/stack.ts";
import type { ServiceInstance, StackDetail, StackSummary } from "../../../common/stack.ts";
import type { Scenario } from "./types.ts";

// 60 stacks over 4 endpoints (this host plus three remotes): 15 stacks each. wide-stack
// replaces one of the local 15, giving that endpoint 12 ordinary stacks plus the wide one.
const LOCAL_ORDINARY_COUNT = 14;
const REMOTE_ENDPOINTS = ["pi.local:5001", "nas2.local:5001", "edge.local:5001"];
const REMOTE_STACK_COUNT = 15;
const WIDE_SERVICE_COUNT = 12;
const WIDE_PORTS_PER_SERVICE = 20;

function buildLocalStacks(): Record<string, StackSummary> {
    const stacks: Record<string, StackSummary> = {};
    for (let i = 0; i < LOCAL_ORDINARY_COUNT; i += 1) {
        const name = `stack-${String(i).padStart(2, "0")}`;
        stacks[name] = { name, status: RUNNING, managed: true, composeFileName: "compose.yaml" };
    }
    stacks["wide-stack"] = {
        name: "wide-stack",
        status: RUNNING,
        managed: true,
        composeFileName: "compose.yaml",
    };
    return stacks;
}

function buildWideStackDetail(): StackDetail {
    const lines = ["services:"];
    for (let i = 0; i < WIDE_SERVICE_COUNT; i += 1) {
        lines.push(`  svc-${i}:`, "    image: alpine:latest", "    ports:");
        for (let p = 0; p < WIDE_PORTS_PER_SERVICE; p += 1) {
            lines.push(`      - "${8000 + i * WIDE_PORTS_PER_SERVICE + p}:80"`);
        }
    }
    return {
        name: "wide-stack",
        status: RUNNING,
        managed: true,
        composeFileName: "compose.yaml",
        composeYAML: lines.join("\n") + "\n",
        composeENV: "",
        primaryHostname: "nas.local",
    };
}

function buildWideStatus(): Record<string, ServiceInstance[]> {
    const status: Record<string, ServiceInstance[]> = {};
    for (let i = 0; i < WIDE_SERVICE_COUNT; i += 1) {
        status[`svc-${i}`] = [{ name: `wide-stack-svc-${i}-1`, status: "running" }];
    }
    return status;
}

function buildAgentStacks(): Record<string, Record<string, StackSummary>> {
    const out: Record<string, Record<string, StackSummary>> = {};
    for (const endpoint of REMOTE_ENDPOINTS) {
        const stacks: Record<string, StackSummary> = {};
        for (let i = 0; i < REMOTE_STACK_COUNT; i += 1) {
            const name = `remote-${String(i).padStart(2, "0")}`;
            stacks[name] = { name, status: RUNNING, managed: true, composeFileName: "compose.yaml" };
        }
        out[endpoint] = stacks;
    }
    return out;
}

const scenario: Scenario = {
    settings: {
        disableAuth: false,
        primaryHostname: "nas.local",
        checkUpdate: true,
        checkBeta: false,
        autoUpgrade: false,
        trustProxy: false,
        globalENV: "# VARIABLE=value #comment",
    },
    stacks: buildLocalStacks(),
    stackDetails: { "wide-stack": buildWideStackDetail() },
    serviceStatus: { "wide-stack": buildWideStatus() },
    stats: {},
    networks: ["bridge", "proxy", "internal", "media", "monitoring"],
    agents: {
        "": { url: "", endpoint: "", username: "", name: "" },
        ...Object.fromEntries(
            REMOTE_ENDPOINTS.map((endpoint) => [
                endpoint,
                { url: `http://${endpoint}`, endpoint, username: "admin", name: "" },
            ]),
        ),
    },
    agentStacks: buildAgentStacks(),
    terminalBuffer: "",
    latencyMs: 0,
};

export default scenario;
