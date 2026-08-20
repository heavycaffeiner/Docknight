import { RUNNING } from "../../../common/stack.ts";
import type { Scenario } from "./types.ts";

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
    stacks: {
        solo: { name: "solo", status: RUNNING, managed: true, composeFileName: "compose.yaml" },
    },
    stackDetails: {
        solo: {
            name: "solo",
            status: RUNNING,
            managed: true,
            composeFileName: "compose.yaml",
            composeYAML: "services:\n  web:\n    image: nginx:alpine\n    ports:\n      - \"8080:80\"\n",
            composeENV: "",
            primaryHostname: "nas.local",
        },
    },
    serviceStatus: {
        solo: { web: [{ name: "solo-web-1", status: "running" }] },
    },
    stats: {
        "solo-web-1": { Name: "solo-web-1", CPUPerc: "0.10%", MemUsage: "12MiB / 8GiB", MemPerc: "0.15%" },
    },
    networks: ["bridge"],
    agents: { "": { url: "", endpoint: "", username: "", name: "" } },
    agentStacks: {},
    terminalBuffer: "",
    latencyMs: 0,
};

export default scenario;
