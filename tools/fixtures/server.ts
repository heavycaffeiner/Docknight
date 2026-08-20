import { createServer, type Server } from "node:http";
import type { ClientMessage, ProtocolError, ServerMessage } from "../../common/protocol.ts";
import { WebSocketServer, type WebSocket } from "ws";
import { loadScenario, type ScenarioName } from "./data/index.ts";

const WS_PATH = "/ws";
const FIXTURE_USERNAME = "fixture";
const FIXTURE_PASSWORD = "fixture-password-1";
const FIXTURE_TOKEN = "fixture-token";

export interface FixtureServer {
    port: number;
    /** Push an event to every connected, authenticated client. */
    emit(event: string, endpoint: string, data: unknown): void;
    close(): Promise<void>;
}

function error(code: ProtocolError["code"], message: string, i18n?: string): ProtocolError {
    return i18n === undefined ? { code, message } : { code, message, i18n };
}

function delay(ms: number): Promise<void> {
    return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start a deterministic protocol server backed by a named scenario. Reads no clock and
 * generates no random values, so two runs produce identical transcripts. There is no origin
 * check and no protocol version check: this server exists only for UI development and
 * verification, never for production traffic.
 */
export function startFixtureServer(scenarioName: ScenarioName, port: number): Promise<FixtureServer> {
    const scenario = loadScenario(scenarioName);
    const httpServer: Server = createServer((_request, response) => {
        response.writeHead(404).end();
    });
    const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
    const authedSockets = new Set<WebSocket>();

    function send(socket: WebSocket, message: ServerMessage): void {
        if (socket.readyState !== socket.OPEN) return;
        socket.send(JSON.stringify(message));
    }

    function sendResult(socket: WebSocket, id: number, data: unknown): void {
        send(socket, { t: "res", id, ok: true, data });
    }

    function sendError(socket: WebSocket, id: number, err: ProtocolError): void {
        send(socket, { t: "res", id, ok: false, error: err });
    }

    function pushAfterLogin(socket: WebSocket): void {
        send(socket, {
            t: "evt",
            endpoint: "",
            event: "info",
            data: {
                version: "0.0.0-fixture",
                protocolVersion: 1,
                isContainer: false,
                primaryHostname: scenario.settings.primaryHostname,
            },
        });
        send(socket, { t: "evt", endpoint: "", event: "stackList", data: { stacks: scenario.stacks } });
        for (const [endpoint, stacks] of Object.entries(scenario.agentStacks)) {
            send(socket, { t: "evt", endpoint, event: "stackList", data: { stacks } });
        }
        send(socket, { t: "evt", endpoint: "", event: "agentList", data: { agents: scenario.agents } });
        for (const endpoint of Object.keys(scenario.agents)) {
            if (endpoint === "") continue;
            const offline = scenarioName === "degraded";
            send(socket, {
                t: "evt",
                endpoint: "",
                event: "agentStatus",
                data: { endpoint, status: offline ? "offline" : "online" },
            });
        }
    }

    function serviceStatusFor(name: string): unknown {
        return scenario.serviceStatus[name] ?? {};
    }

    async function handleRequest(socket: WebSocket, msg: Extract<ClientMessage, { t: "req" }>): Promise<void> {
        await delay(scenario.latencyMs);

        if (msg.method === "auth.login") {
            const params = msg.params as { username?: unknown; password?: unknown } | undefined;
            if (params?.username === FIXTURE_USERNAME && params.password === FIXTURE_PASSWORD) {
                authedSockets.add(socket);
                sendResult(socket, msg.id, { token: FIXTURE_TOKEN, username: FIXTURE_USERNAME });
                pushAfterLogin(socket);
            } else {
                sendError(socket, msg.id, error("unauthorized", "incorrect credentials", "authIncorrectCreds"));
            }
            return;
        }

        if (msg.method === "auth.loginByToken") {
            const params = msg.params as { token?: unknown } | undefined;
            if (params?.token === FIXTURE_TOKEN) {
                authedSockets.add(socket);
                sendResult(socket, msg.id, { username: FIXTURE_USERNAME });
                pushAfterLogin(socket);
            } else {
                sendError(socket, msg.id, error("unauthorized", "that session is no longer valid", "authSessionExpired"));
            }
            return;
        }

        if (!authedSockets.has(socket)) {
            sendError(socket, msg.id, error("unauthorized", "not authenticated"));
            return;
        }

        switch (msg.method) {
            case "settings.get": {
                sendResult(socket, msg.id, scenario.settings);
                return;
            }
            case "settings.set": {
                sendResult(socket, msg.id, { ok: true });
                return;
            }
            case "stack.list": {
                sendResult(socket, msg.id, { stacks: scenario.stacks });
                return;
            }
            case "stack.get": {
                const params = msg.params as { name?: unknown } | undefined;
                const name = typeof params?.name === "string" ? params.name : "";
                const detail = scenario.stackDetails[name];
                if (detail === undefined) {
                    sendError(socket, msg.id, error("notFound", `no stack named ${name}`, "stackNotFound"));
                    return;
                }
                sendResult(socket, msg.id, { stack: detail });
                return;
            }
            case "stack.serviceStatus": {
                const params = msg.params as { name?: unknown } | undefined;
                const name = typeof params?.name === "string" ? params.name : "";
                sendResult(socket, msg.id, { services: serviceStatusFor(name) });
                return;
            }
            case "docker.stats": {
                sendResult(socket, msg.id, { stats: scenario.stats });
                return;
            }
            case "docker.networks": {
                sendResult(socket, msg.id, { networks: scenario.networks });
                return;
            }
            case "agent.list": {
                sendResult(socket, msg.id, { agents: scenario.agents });
                return;
            }
            case "terminal.join": {
                sendResult(socket, msg.id, { buffer: scenario.terminalBuffer, exited: false, exitCode: null });
                return;
            }
            case "terminal.leave":
            case "terminal.input":
            case "terminal.resize": {
                sendResult(socket, msg.id, { ok: true });
                return;
            }
            case "terminal.mainEnabled": {
                sendResult(socket, msg.id, { enabled: true });
                return;
            }
            case "terminal.main": {
                sendResult(socket, msg.id, { terminal: "shell-fixture" });
                return;
            }
            case "terminal.exec": {
                sendResult(socket, msg.id, { terminal: "exec-fixture" });
                return;
            }
            case "docker.composerize": {
                const params = msg.params as { command?: unknown } | undefined;
                const command = typeof params?.command === "string" ? params.command : "";
                if (command.trim() === "") {
                    sendError(socket, msg.id, error("validation", "command is empty"));
                    return;
                }
                sendResult(socket, msg.id, {
                    yaml: "services:\n  app:\n    image: fixture/from-composerize:latest\n",
                });
                return;
            }
            default: {
                if (isMutatingStackMethod(msg.method)) {
                    sendResult(socket, msg.id, { exitCode: 0, ok: true });
                    send(socket, { t: "evt", endpoint: "", event: "stackList", data: { stacks: scenario.stacks } });
                    return;
                }
                sendError(socket, msg.id, error("unknownMethod", `no method ${msg.method}`));
            }
        }
    }

    function isMutatingStackMethod(method: string): boolean {
        return (
            method.startsWith("stack.") &&
            method !== "stack.list" &&
            method !== "stack.get" &&
            method !== "stack.serviceStatus"
        );
    }

    wss.on("connection", (socket: WebSocket) => {
        socket.on("message", (raw: Buffer) => {
            let json: unknown;
            try {
                json = JSON.parse(raw.toString("utf8"));
            } catch {
                return;
            }
            const candidate = json as Partial<ClientMessage>;
            if (candidate.t === "ping") {
                send(socket, { t: "pong" });
                return;
            }
            if (candidate.t === "req") {
                void handleRequest(socket, candidate as Extract<ClientMessage, { t: "req" }>);
                return;
            }
            // "cancel" is a no-op here: every fixture response either already resolved
            // synchronously or is waiting out the scenario's fixed latency, and cutting that
            // wait short would make transcripts depend on timing rather than being deterministic.
        });
        socket.on("close", () => {
            authedSockets.delete(socket);
        });
    });

    return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, "127.0.0.1", () => {
            httpServer.off("error", reject);
            const address = httpServer.address();
            const boundPort = typeof address === "object" && address !== null ? address.port : port;
            resolve({
                port: boundPort,
                emit(event, endpoint, data) {
                    for (const socket of authedSockets) {
                        send(socket, { t: "evt", endpoint, event, data });
                    }
                },
                close(): Promise<void> {
                    return new Promise((res) => {
                        wss.close(() => {
                            httpServer.close(() => res());
                        });
                    });
                },
            });
        });
    });
}
