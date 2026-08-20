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
        healthy: { name: "healthy", status: RUNNING, managed: true, composeFileName: "compose.yaml" },
        // Reported by `docker compose ls` but no longer present under stacksDir.
        orphaned: { name: "orphaned", status: RUNNING, managed: false, composeFileName: "" },
        broken: { name: "broken", status: 0, managed: true, composeFileName: "compose.yaml" },
    },
    stackDetails: {
        healthy: {
            name: "healthy",
            status: RUNNING,
            managed: true,
            composeFileName: "compose.yaml",
            composeYAML: "services:\n  web:\n    image: nginx:alpine\n",
            composeENV: "",
            primaryHostname: "nas.local",
        },
        // Invalid YAML left on disk, exactly as a user's own editor mistake would produce it.
        broken: {
            name: "broken",
            status: 0,
            managed: true,
            composeFileName: "compose.yaml",
            composeYAML: "services:\n  web\n    image nginx\n",
            composeENV: "",
            primaryHostname: "nas.local",
        },
    },
    serviceStatus: {
        healthy: { web: [{ name: "healthy-web-1", status: "running" }] },
    },
    stats: {},
    networks: ["bridge"],
    agents: {
        "": { url: "", endpoint: "", username: "", name: "" },
        "pi.local:5001": { url: "http://pi.local:5001", endpoint: "pi.local:5001", username: "admin", name: "Raspberry Pi" },
        "nas2.local:5001": { url: "http://nas2.local:5001", endpoint: "nas2.local:5001", username: "admin", name: "" },
    },
    agentStacks: {},
    terminalBuffer: "",
    latencyMs: 0,
};

export default scenario;
