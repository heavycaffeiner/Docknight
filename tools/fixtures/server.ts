import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { LOCAL_ENDPOINT, PROTOCOL_VERSION, type ProtocolError } from "../../common/protocol.ts";
import { DEFAULT_COMPOSE_FILE_NAME } from "../../common/stack.ts";
import { UPGRADE_TERMINAL_NAME } from "../../common/terminal.ts";
import {
    FIXTURE_PASSWORD,
    FIXTURE_TOKEN,
    FIXTURE_USERNAME,
    SCENARIOS,
    type Scenario,
    type ScenarioName,
} from "./data/scenarios.ts";

/**
 * A deterministic protocol server backed by a named scenario. It reads no clock and generates no
 * random values, so two runs produce identical output and a screenshot is stable.
 */
export interface FixtureServer {
    /** Push an event to every connected client, for testing live-update paths. */
    emit(event: string, endpoint: string, data: unknown): void;
    close(): Promise<void>;
}

interface Client {
    socket: WebSocket;
    authenticated: boolean;
}

/**
 * The built frontend, served so the SPA and /ws share one origin. Absent during `pnpm fixtures`,
 * where Vite serves the SPA and proxies the socket here; present during a verification run.
 */
const STATIC_ROOT = fileURLToPath(new URL("../../dist/frontend/", import.meta.url));

/**
 * The same manifest Vite compiles into the bundle. Reporting anything else makes the shell treat
 * the page as stale and reload it, which destroys the fixture run rather than failing a check.
 */
const VERSION = (
    JSON.parse(
        readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
    ) as { version: string }
).version;

/** One minor above, so the update-available state renders whatever the real version is. */
const LATEST_VERSION = ((): string => {
    const [major = 0, minor = 0] = VERSION.split("-")[0]?.split(".").map(Number) ?? [];
    return `${major}.${minor + 1}.0`;
})();

const MIME_TYPES: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
    ".woff2": "font/woff2",
};

/** Resolve a request path inside the static root, or null when it escapes or cannot be decoded. */
function resolveStatic(url: string): string | null {
    let pathname: string;
    try {
        pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
    } catch {
        return null;
    }
    if (pathname.includes("\0")) return null;
    const root = resolve(STATIC_ROOT);
    const candidate = resolve(join(root, normalize(pathname)));
    return candidate === root || candidate.startsWith(root + sep) ? candidate : null;
}

async function readIfFile(path: string): Promise<Buffer | null> {
    try {
        if (!(await stat(path)).isFile()) return null;
        return await readFile(path);
    } catch {
        return null;
    }
}

async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = resolveStatic(request.url ?? "/");
    if (path === null) {
        response.statusCode = 400;
        response.end();
        return;
    }

    // Anything without an extension is a client route, so the shell answers it.
    const direct = extname(path) === "" ? null : await readIfFile(path);
    const body = direct ?? (await readIfFile(join(STATIC_ROOT, "index.html")));
    if (body === null) {
        response.statusCode = 404;
        response.end();
        return;
    }

    const type = direct === null ? ".html" : extname(path);
    response.setHeader("content-type", MIME_TYPES[type] ?? "application/octet-stream");
    response.setHeader("cache-control", "no-store");
    response.end(body);
}

function error(code: ProtocolError["code"], message: string, i18n?: string): ProtocolError {
    return i18n === undefined ? { code, message } : { code, message, i18n };
}

export function startFixtureServer(
    scenarioName: ScenarioName,
    port: number,
): Promise<FixtureServer> {
    const scenario: Scenario = SCENARIOS[scenarioName]();
    const clients = new Set<Client>();

    const http: Server = createServer((request, response) => {
        void serveStatic(request, response).catch(() => {
            response.statusCode = 500;
            response.end();
        });
    });
    const wss = new WebSocketServer({ noServer: true });

    http.on("upgrade", (request, socket, head) => {
        // The origin check is skipped on purpose: the harness drives this from a test runner.
        if (!(request.url ?? "").startsWith("/ws")) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => accept(ws));
    });

    function send(socket: WebSocket, payload: unknown): void {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    }

    function sendEvent(socket: WebSocket, event: string, endpoint: string, data: unknown): void {
        send(socket, { t: "evt", endpoint, event, data });
    }

    function primeAuthenticated(socket: WebSocket): void {
        sendEvent(socket, "stackList", LOCAL_ENDPOINT, { stacks: scenario.stacks });
        sendEvent(socket, "agentList", LOCAL_ENDPOINT, { agents: scenario.agents });
        for (const [endpoint, status] of Object.entries(scenario.agentStatus)) {
            sendEvent(socket, "agentStatus", endpoint, { endpoint, status });
        }
    }

    function info(): unknown {
        return {
            version: VERSION,
            protocolVersion: PROTOCOL_VERSION,
            latestVersion: LATEST_VERSION,
            isContainer: true,
            primaryHostname: scenario.settings.primaryHostname,
        };
    }

    function handle(client: Client, method: string, params: Record<string, unknown>): unknown {
        switch (method) {
            case "auth.login": {
                if (params.username !== FIXTURE_USERNAME || params.password !== FIXTURE_PASSWORD) {
                    throw error("unauthorized", "bad credentials", "authIncorrectCreds");
                }
                client.authenticated = true;
                primeAuthenticated(client.socket);
                return { token: FIXTURE_TOKEN, username: FIXTURE_USERNAME };
            }
            case "auth.loginByToken": {
                if (params.token !== FIXTURE_TOKEN) {
                    throw error("unauthorized", "unknown token", "authSessionExpired");
                }
                client.authenticated = true;
                primeAuthenticated(client.socket);
                return { username: FIXTURE_USERNAME };
            }
            case "auth.logout":
                client.authenticated = false;
                return { ok: true };
            case "settings.get":
                return scenario.settings;
            case "settings.set":
                return { ok: true };
            case "stack.list":
                return { stacks: scenario.stacks };
            case "stack.get": {
                const name = String(params.name ?? "");
                const summary = scenario.stacks[name];
                if (summary === undefined) {
                    throw error("notFound", `no stack ${name}`, "stackNotFound");
                }
                const text = scenario.composeText[name] ?? { composeYAML: "services: {}\n", composeENV: "" };
                return {
                    stack: {
                        ...summary,
                        composeFileName: summary.composeFileName || DEFAULT_COMPOSE_FILE_NAME,
                        composeYAML: text.composeYAML,
                        composeENV: text.composeENV,
                        primaryHostname: scenario.settings.primaryHostname,
                    },
                };
            }
            case "stack.serviceStatus":
                return { services: scenario.serviceStatus[String(params.name ?? "")] ?? {} };
            case "docker.stats":
                return { stats: scenario.stats };
            case "docker.networks":
                return { networks: scenario.networks };
            case "docker.composerize":
                return { yaml: "services:\n  app:\n    image: nginx:latest\n" };
            case "agent.list":
                return { agents: scenario.agents };
            case "terminal.join":
                return { buffer: scenario.terminalBuffer, exited: true, exitCode: 0 };
            case "terminal.leave":
            case "terminal.input":
            case "terminal.resize":
                return { ok: true };
            case "terminal.exec":
                return { terminal: `exec--${String(params.stack ?? "")}-fixture` };
            case "terminal.main":
                return { terminal: "shell-fixture" };
            case "terminal.mainEnabled":
                return { enabled: scenario.consoleEnabled };
            case "upgrade.status":
                return {
                    supported: true,
                    image: "ghcr.io/heavycaffeiner/docknight:latest",
                    running: false,
                    terminal: UPGRADE_TERMINAL_NAME,
                };
            case "upgrade.start":
                return { terminal: UPGRADE_TERMINAL_NAME };
            case "version.check":
                return { latestVersion: LATEST_VERSION };
            default:
                // Every mutating method succeeds and re-emits the affected list.
                for (const other of clients) {
                    if (!other.authenticated) continue;
                    sendEvent(other.socket, "stackList", LOCAL_ENDPOINT, { stacks: scenario.stacks });
                }
                return { exitCode: 0, ok: true };
        }
    }

    function accept(socket: WebSocket): void {
        const client: Client = { socket, authenticated: false };
        clients.add(client);

        // Every scenario is post-setup, so no `setup` event is emitted.
        sendEvent(socket, "info", LOCAL_ENDPOINT, info());

        socket.on("message", (raw: Buffer) => {
            let message: { t?: string; id?: number; method?: string; params?: unknown };
            try {
                message = JSON.parse(raw.toString("utf8")) as typeof message;
            } catch {
                socket.close(1003, "unparseable");
                return;
            }
            if (message.t === "ping") {
                send(socket, { t: "pong" });
                return;
            }
            if (message.t !== "req" || typeof message.id !== "number" || typeof message.method !== "string") {
                return;
            }

            const respond = (): void => {
                try {
                    const data = handle(
                        client,
                        message.method as string,
                        (message.params ?? {}) as Record<string, unknown>,
                    );
                    send(socket, { t: "res", id: message.id, ok: true, data });
                } catch (thrown) {
                    send(socket, { t: "res", id: message.id, ok: false, error: thrown as ProtocolError });
                }
            };

            if (scenario.latency > 0) setTimeout(respond, scenario.latency);
            else respond();
        });

        socket.on("close", () => clients.delete(client));
    }

    return new Promise<FixtureServer>((resolve) => {
        http.listen(port, "127.0.0.1", () => {
            resolve({
                emit(event, endpoint, data) {
                    for (const client of clients) sendEvent(client.socket, event, endpoint, data);
                },
                close() {
                    return new Promise<void>((done) => {
                        for (const client of clients) client.socket.close(1001, "fixture closing");
                        wss.close();
                        http.close(() => done());
                    });
                },
            });
        });
    });
}
