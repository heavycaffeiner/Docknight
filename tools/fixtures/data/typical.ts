import { CREATED, EXITED, RUNNING } from "../../../common/stack.ts";
import type { Scenario } from "./types.ts";

const IMMICH_COMPOSE = `# Photo library
services:
  immich-server:
    image: ghcr.io/immich-app/immich-server:v1.118.0
    ports:
      - "2283:2283"
    volumes:
      - ./library:/usr/src/app/upload
    depends_on:
      - immich-postgres
      - immich-redis
    restart: unless-stopped
  immich-postgres:
    image: tensorchord/pgvecto-rs:pg14-v0.2.0
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    restart: unless-stopped
  immich-redis:
    image: redis:6.2-alpine
    restart: unless-stopped
`;

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
        immich: { name: "immich", status: RUNNING, managed: true, composeFileName: "compose.yaml" },
        jellyfin: { name: "jellyfin", status: RUNNING, managed: true, composeFileName: "compose.yaml" },
        pihole: { name: "pihole", status: EXITED, managed: true, composeFileName: "compose.yaml" },
        vaultwarden: {
            name: "vaultwarden",
            status: CREATED,
            managed: true,
            composeFileName: "docker-compose.yml",
        },
        homeassistant: {
            name: "homeassistant",
            status: RUNNING,
            managed: false,
            composeFileName: "",
        },
        scratch: { name: "scratch", status: 0, managed: true, composeFileName: "compose.yaml" },
    },
    stackDetails: {
        immich: {
            name: "immich",
            status: RUNNING,
            managed: true,
            composeFileName: "compose.yaml",
            composeYAML: IMMICH_COMPOSE,
            composeENV: "DB_PASSWORD=fixture-secret\n",
            primaryHostname: "nas.local",
        },
        jellyfin: {
            name: "jellyfin",
            status: RUNNING,
            managed: true,
            composeFileName: "compose.yaml",
            composeYAML:
                "services:\n  jellyfin:\n    image: jellyfin/jellyfin:latest\n    ports:\n      - \"8096:8096\"\n    restart: unless-stopped\n",
            composeENV: "",
            primaryHostname: "nas.local",
        },
        pihole: {
            name: "pihole",
            status: EXITED,
            managed: true,
            composeFileName: "compose.yaml",
            composeYAML:
                "services:\n  pihole:\n    image: pihole/pihole:2024.07.0\n    ports:\n      - \"53:53/tcp\"\n      - \"53:53/udp\"\n      - \"8080:80\"\n    restart: unless-stopped\n",
            composeENV: "",
            primaryHostname: "nas.local",
        },
        vaultwarden: {
            name: "vaultwarden",
            status: CREATED,
            managed: true,
            composeFileName: "docker-compose.yml",
            composeYAML:
                "services:\n  vaultwarden:\n    image: vaultwarden/server:latest\n    ports:\n      - \"8081:80\"\n",
            composeENV: "",
            primaryHostname: "nas.local",
        },
        scratch: {
            name: "scratch",
            status: 0,
            managed: true,
            composeFileName: "compose.yaml",
            composeYAML: "services: {}\n",
            composeENV: "",
            primaryHostname: "nas.local",
        },
    },
    serviceStatus: {
        immich: {
            "immich-server": [{ name: "immich-immich-server-1", status: "healthy" }],
            "immich-postgres": [{ name: "immich-immich-postgres-1", status: "healthy" }],
            "immich-redis": [{ name: "immich-immich-redis-1", status: "running" }],
        },
        jellyfin: { jellyfin: [{ name: "jellyfin-jellyfin-1", status: "running" }] },
        pihole: { pihole: [{ name: "pihole-pihole-1", status: "exited" }] },
    },
    stats: {
        "immich-immich-server-1": { Name: "immich-immich-server-1", CPUPerc: "2.31%", MemUsage: "412MiB / 8GiB", MemPerc: "5.03%" },
        "immich-immich-postgres-1": { Name: "immich-immich-postgres-1", CPUPerc: "0.44%", MemUsage: "128MiB / 8GiB", MemPerc: "1.56%" },
        "jellyfin-jellyfin-1": { Name: "jellyfin-jellyfin-1", CPUPerc: "12.02%", MemUsage: "980MiB / 8GiB", MemPerc: "11.96%" },
    },
    networks: ["bridge", "proxy"],
    agents: {
        "": { url: "", endpoint: "", username: "", name: "" },
        "pi.local:5001": { url: "http://pi.local:5001", endpoint: "pi.local:5001", username: "admin", name: "Raspberry Pi" },
    },
    agentStacks: {
        "pi.local:5001": {
            "pihole-edge": { name: "pihole-edge", status: RUNNING, managed: true, composeFileName: "compose.yaml" },
        },
    },
    terminalBuffer: "Pulling immich-server ... done\r\nCreating immich-server ... done\r\n",
    latencyMs: 0,
};

export default scenario;
