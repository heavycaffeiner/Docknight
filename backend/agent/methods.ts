import { AppError } from "../../common/errors.ts";
import { obj, optional, str } from "../../common/validate.ts";
import type { Config } from "../config.ts";
import { method } from "../ws/router.ts";
import type { WsLayer } from "../ws/server.ts";
import { encryptSecret } from "./crypto.ts";
import type { AgentPool } from "./pool.ts";
import { agentStore, deriveEndpoint, normaliseUrl } from "./store.ts";

declare module "../../common/protocol.ts" {
    interface MethodMap {
        "agent.list": {
            params: undefined;
            result: { agents: Record<string, AgentSummary> };
        };
        "agent.add": {
            params: { url: string; username: string; password: string; name?: string };
            result: { endpoint: string };
        };
        "agent.remove": { params: { url: string }; result: { ok: true } };
        "agent.rename": { params: { url: string; name: string }; result: { ok: true } };
    }

    interface EventMap {
        agentList: { agents: Record<string, AgentSummary> };
    }
}

export interface AgentSummary {
    url: string;
    endpoint: string;
    username: string;
    name: string;
}

function ownListeningHost(config: Readonly<Config>): string {
    return `${config.hostname ?? "127.0.0.1"}:${config.port}`;
}

/** Every configured host plus the synthetic local entry keyed by the empty string. */
export function buildAgentList(): Record<string, AgentSummary> {
    const result: Record<string, AgentSummary> = {
        "": { url: "", endpoint: "", username: "", name: "" },
    };
    for (const row of agentStore.list()) {
        const endpoint = deriveEndpoint(row.url);
        result[endpoint] = { url: row.url, endpoint, username: row.username, name: row.name ?? "" };
    }
    return result;
}

const addParse = obj({
    url: str({ max: 2048 }),
    username: str({ min: 1, max: 64 }),
    password: str({ min: 1, max: 1024 }),
    name: optional(str({ max: 128 })),
});
const urlParse = obj({ url: str({ max: 2048 }) });
const renameParse = obj({ url: str({ max: 2048 }), name: str({ max: 128 }) });

export function registerAgentMethods(
    pool: AgentPool,
    ws: WsLayer,
    config: Readonly<Config>,
    key: Buffer,
): void {
    function emitAgentList(): void {
        ws.broadcastEvent((conn) => conn.userId !== null, "", "agentList", { agents: buildAgentList() });
    }

    method("agent.list", {
        requiresAuth: true,
        routable: false,
        parse: () => undefined,
        handle: () => ({ agents: buildAgentList() }),
    });

    method("agent.add", {
        requiresAuth: true,
        routable: false,
        parse: addParse,
        handle: async (_conn, params) => {
            const url = normaliseUrl(params.url);
            const endpoint = deriveEndpoint(url);
            if (endpoint === ownListeningHost(config)) {
                throw new AppError("validation", "cannot add this host as its own agent", "cannotAddSelf");
            }
            if (agentStore.byUrl(url) !== undefined) {
                throw new AppError("conflict", `an agent for ${url} already exists`, "agentAlreadyExists");
            }
            // A real connect-and-login before the row is stored, so a typo in the URL or the
            // password becomes a form error rather than a permanently offline row.
            await pool.testConnection(url, params.username, params.password);
            const row = agentStore.add(url, params.username, encryptSecret(key, params.password), params.name);
            pool.connect(row);
            emitAgentList();
            return { endpoint: deriveEndpoint(row.url) };
        },
    });

    method("agent.remove", {
        requiresAuth: true,
        routable: false,
        parse: urlParse,
        handle: (_conn, params) => {
            const url = normaliseUrl(params.url);
            const row = agentStore.byUrl(url);
            if (row === undefined) {
                throw new AppError("notFound", `no agent for ${url}`, "agentNotFound");
            }
            const endpoint = deriveEndpoint(row.url);
            pool.disconnect(endpoint);
            agentStore.remove(row.url);
            pool.stackCache.delete(endpoint);
            pool.statuses.delete(endpoint);
            emitAgentList();
            return { ok: true as const };
        },
    });

    method("agent.rename", {
        requiresAuth: true,
        routable: false,
        parse: renameParse,
        handle: (_conn, params) => {
            const url = normaliseUrl(params.url);
            if (agentStore.byUrl(url) === undefined) {
                throw new AppError("notFound", `no agent for ${url}`, "agentNotFound");
            }
            agentStore.rename(url, params.name);
            emitAgentList();
            return { ok: true as const };
        },
    });
}
