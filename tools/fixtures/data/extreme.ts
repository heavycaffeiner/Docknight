import { RUNNING } from "../../../common/stack.ts";
import type { Scenario } from "./types.ts";

// A 63-character stack name: the server's NAME_RE allows up to 63 characters total.
const LONG_NAME = "a" + "-".repeat(30) + "b".repeat(32);
// An 80-character image reference: a long registry host plus a long repository path and tag.
const LONG_IMAGE =
    "registry.extremely-long-example-hostname.internal:5000/team/project/service:v1.2.3-build.456789";
const LONG_SERVICE_NAME = "s" + "vc".repeat(19); // 39 characters, kept under the 40 limit
const LONG_VOLUME_PATH = "/mnt/storage/very/deeply/nested/directory/structure/for/the/volume/mount123";

const scenario: Scenario = {
    settings: {
        disableAuth: false,
        primaryHostname: "extremely-long-hostname-for-this-fixture-scenario.example.internal",
        checkUpdate: true,
        checkBeta: false,
        autoUpgrade: false,
        trustProxy: false,
        globalENV: "# VARIABLE=value #comment",
    },
    stacks: {
        [LONG_NAME]: { name: LONG_NAME, status: RUNNING, managed: true, composeFileName: "compose.yaml" },
    },
    stackDetails: {
        [LONG_NAME]: {
            name: LONG_NAME,
            status: RUNNING,
            managed: true,
            composeFileName: "compose.yaml",
            composeYAML:
                `services:\n  ${LONG_SERVICE_NAME}:\n    image: ${LONG_IMAGE}\n    volumes:\n      - ${LONG_VOLUME_PATH}:/data\n    ports:\n` +
                Array.from({ length: 20 }, (_v, p) => `      - "${9000 + p}:${9000 + p}"`).join("\n") +
                "\n",
            composeENV: "",
            primaryHostname: "extremely-long-hostname-for-this-fixture-scenario.example.internal",
        },
    },
    serviceStatus: {
        [LONG_NAME]: {
            [LONG_SERVICE_NAME]: [{ name: `${LONG_NAME}-${LONG_SERVICE_NAME}-1`, status: "running" }],
        },
    },
    stats: {},
    networks: ["bridge"],
    agents: { "": { url: "", endpoint: "", username: "", name: "" } },
    agentStacks: {},
    terminalBuffer: "",
    latencyMs: 0,
};

export default scenario;
