import type { Scenario } from "./types.ts";

const scenario: Scenario = {
    settings: {
        disableAuth: false,
        primaryHostname: "",
        checkUpdate: true,
        checkBeta: false,
        autoUpgrade: false,
        trustProxy: false,
        globalENV: "# VARIABLE=value #comment",
    },
    stacks: {},
    stackDetails: {},
    serviceStatus: {},
    stats: {},
    networks: ["bridge"],
    agents: { "": { url: "", endpoint: "", username: "", name: "" } },
    agentStacks: {},
    terminalBuffer: "",
    latencyMs: 0,
};

export default scenario;
