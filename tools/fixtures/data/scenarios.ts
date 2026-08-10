import type { AgentSummary, GeneralSettings } from "../../../common/protocol.ts";
import {
    CREATED,
    DRAFT,
    EXITED,
    RUNNING,
    UNKNOWN,
    type DockerStat,
    type ServiceInstance,
    type StackSummary,
} from "../../../common/stack.ts";

export interface Scenario {
    settings: GeneralSettings & { globalENV: string; totpEnabled: boolean };
    stacks: Record<string, StackSummary>;
    composeText: Record<string, { composeYAML: string; composeENV: string }>;
    serviceStatus: Record<string, Record<string, ServiceInstance[]>>;
    stats: Record<string, DockerStat>;
    agents: Record<string, AgentSummary>;
    agentStatus: Record<string, "connecting" | "online" | "offline">;
    networks: string[];
    terminalBuffer: string;
    /** Zero by default. A dedicated scenario sets it high to exercise pending states. */
    latency: number;
    consoleEnabled: boolean;
}

const BASE_SETTINGS: Scenario["settings"] = {
    disableAuth: false,
    primaryHostname: "example.test",
    checkUpdate: true,
    checkBeta: false,
    trustProxy: false,
    autoUpgrade: false,
    globalENV: "# VARIABLE=value #comment",
    totpEnabled: false,
};

const LOCAL_AGENT: AgentSummary = { url: "", endpoint: "", username: "", name: "" };

function stack(
    name: string,
    status: StackSummary["status"],
    managed = true,
): StackSummary {
    return { name, status, managed, composeFileName: "compose.yaml" };
}

function compose(image: string, ports: string[]): string {
    return [
        "services:",
        "  app:",
        `    image: ${image}`,
        "    restart: unless-stopped",
        "    ports:",
        ...ports.map((port) => `      - "${port}"`),
        "",
    ].join("\n");
}

function statOf(name: string, cpu: string, mem: string, memPercent: string): DockerStat {
    return {
        Name: name,
        ID: `fixture-${name}`,
        CPUPerc: cpu,
        MemUsage: mem,
        MemPerc: memPercent,
        NetIO: "1.2MB / 480kB",
        BlockIO: "0B / 12.3MB",
        PIDs: "7",
    };
}

const TERMINAL_BUFFER = [
    "[32m[+] Running 3/3[0m",
    " [32m✔[0m Network app_default   Created",
    " [32m✔[0m Container app-db-1    Started",
    " [32m✔[0m Container app-web-1   Started",
    "",
].join("\r\n");

function base(): Scenario {
    return {
        settings: { ...BASE_SETTINGS },
        stacks: {},
        composeText: {},
        serviceStatus: {},
        stats: {},
        agents: { "": LOCAL_AGENT },
        agentStatus: {},
        networks: ["bridge", "host", "none", "proxy"],
        terminalBuffer: TERMINAL_BUFFER,
        latency: 0,
        consoleEnabled: true,
    };
}

function typical(): Scenario {
    const scenario = base();
    scenario.stacks = {
        immich: stack("immich", RUNNING),
        jellyfin: stack("jellyfin", RUNNING),
        paperless: stack("paperless", EXITED),
        gitea: stack("gitea", CREATED),
        vaultwarden: stack("vaultwarden", DRAFT),
        "old-blog": stack("old-blog", UNKNOWN, false),
    };
    scenario.composeText = {
        immich: {
            composeYAML: [
                "# Photo library",
                "x-docknight:",
                "  urls:",
                "    - https://photos.example.test",
                "services:",
                "  server:",
                "    image: ghcr.io/immich-app/immich-server:v1.120.0",
                "    restart: unless-stopped",
                "    ports:",
                '      - "${IMMICH_PORT}:2283"',
                "    environment:",
                "      - DB_PASSWORD=${DB_PASSWORD}",
                "  database:",
                "    image: tensorchord/pgvecto-rs:pg16-v0.2.0",
                "    restart: unless-stopped",
                "",
            ].join("\n"),
            composeENV: "IMMICH_PORT=2283\nDB_PASSWORD=fixture\n",
        },
        jellyfin: {
            composeYAML: compose("jellyfin/jellyfin:10.9.11", ["8096:8096"]),
            composeENV: "",
        },
        paperless: { composeYAML: compose("ghcr.io/paperless-ngx/paperless-ngx:2.13", ["8000:8000"]), composeENV: "" },
        gitea: { composeYAML: compose("gitea/gitea:1.22", ["3000:3000"]), composeENV: "" },
        vaultwarden: { composeYAML: compose("vaultwarden/server:1.32", ["8080:80"]), composeENV: "" },
    };
    scenario.serviceStatus = {
        immich: {
            server: [{ name: "immich-server-1", status: "healthy" }],
            database: [{ name: "immich-database-1", status: "running" }],
        },
        jellyfin: { app: [{ name: "jellyfin-app-1", status: "running" }] },
        paperless: { app: [{ name: "paperless-app-1", status: "exited" }] },
        gitea: { app: [{ name: "gitea-app-1", status: "created" }] },
    };
    scenario.stats = {
        "immich-server-1": statOf("immich-server-1", "12.40%", "512MiB / 8GiB", "6.25%"),
        "immich-database-1": statOf("immich-database-1", "1.90%", "128MiB / 8GiB", "1.56%"),
        "jellyfin-app-1": statOf("jellyfin-app-1", "48.10%", "1.5GiB / 8GiB", "18.75%"),
    };
    return scenario;
}

function empty(): Scenario {
    return base();
}

function singleStack(): Scenario {
    const scenario = base();
    scenario.stacks = { alpha: stack("alpha", RUNNING) };
    scenario.composeText = {
        alpha: { composeYAML: compose("nginx:1.27-alpine", ["8080:80"]), composeENV: "" },
    };
    scenario.serviceStatus = { alpha: { app: [{ name: "alpha-app-1", status: "running" }] } };
    scenario.stats = { "alpha-app-1": statOf("alpha-app-1", "0.30%", "12MiB / 8GiB", "0.15%") };
    return scenario;
}

function dense(): Scenario {
    const scenario = typical();
    const hosts = ["", "nas:5001", "pi:5001", "edge:5001"];
    for (const [hostIndex, host] of hosts.entries()) {
        if (host !== "") {
            scenario.agents[host] = {
                url: `https://${host}`,
                endpoint: host,
                username: "admin",
                name: host.split(":")[0] ?? host,
            };
            scenario.agentStatus[host] = "online";
        }
        for (let index = 0; index < 15; index += 1) {
            const name = `stack-${hostIndex}-${String(index).padStart(2, "0")}`;
            scenario.stacks[name] = stack(name, index % 3 === 0 ? RUNNING : index % 3 === 1 ? EXITED : DRAFT);
        }
    }
    const wide = "wide-stack";
    scenario.stacks[wide] = stack(wide, RUNNING);
    scenario.composeText[wide] = {
        composeYAML: [
            "services:",
            ...Array.from({ length: 12 }, (_unused, index) => [
                `  service-${index}:`,
                `    image: registry.example.test/team/product-${index}:1.0.0`,
                "    ports:",
                ...Array.from({ length: 20 }, (_port, portIndex) => `      - "${9000 + portIndex}:${80 + portIndex}"`),
            ].join("\n")),
            "",
        ].join("\n"),
        composeENV: "",
    };
    return scenario;
}

function extreme(): Scenario {
    const scenario = base();
    const longName = "a".repeat(63);
    scenario.stacks[longName] = stack(longName, RUNNING);
    scenario.composeText[longName] = {
        composeYAML: [
            "services:",
            `  ${"service-name-that-reaches-the-compose-limit".slice(0, 40)}:`,
            `    image: registry.example.test/an/extremely/long/repository/path/product:${"v".repeat(20)}1.0.0`,
            "    volumes:",
            `      - ${"/very/long/host/path/segment".repeat(4)}:/data`,
            "",
        ].join("\n"),
        composeENV: "",
    };
    return scenario;
}

function degraded(): Scenario {
    const scenario = typical();
    scenario.agents["nas:5001"] = {
        url: "https://nas:5001",
        endpoint: "nas:5001",
        username: "admin",
        name: "NAS",
    };
    scenario.agents["pi:5001"] = {
        url: "https://pi:5001",
        endpoint: "pi:5001",
        username: "admin",
        name: "",
    };
    scenario.agentStatus["nas:5001"] = "offline";
    scenario.agentStatus["pi:5001"] = "offline";
    scenario.composeText.gitea = {
        composeYAML: "services:\n  app:\n    image: [unclosed\n",
        composeENV: "BROKEN LINE WITHOUT EQUALS\n",
    };
    return scenario;
}

function slow(): Scenario {
    const scenario = typical();
    scenario.latency = 3_000;
    return scenario;
}

export const SCENARIOS = {
    typical,
    empty,
    "single-stack": singleStack,
    dense,
    extreme,
    degraded,
    slow,
} as const;

export type ScenarioName = keyof typeof SCENARIOS;

export const FIXTURE_USERNAME = "fixture";
export const FIXTURE_PASSWORD = "fixture-password-1";
export const FIXTURE_TOKEN = "fixture-token-0000000000000000";
