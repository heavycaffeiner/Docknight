import { conflict, notFound, validation } from "../../common/errors.ts";
import { asObject, noParams, optionalStr, str } from "../../common/validate.ts";
import type { Config } from "../config.ts";
import { log } from "../log.ts";
import { method } from "../ws/router.ts";
import { testConnection } from "./link.ts";
import * as pool from "./pool.ts";
import {
    deleteAgent,
    endpointOf,
    findByUrl,
    insertAgent,
    normaliseUrl,
    renameAgent,
    summaries,
} from "./store.ts";

/**
 * The manager's own listening address, used to refuse the self-referential loop. Only the port is
 * known for certain, so every local name is compared against it.
 */
function isSelf(config: Readonly<Config>, endpoint: string): boolean {
    const [host, portRaw] = splitEndpoint(endpoint);
    const port = portRaw ?? 80;
    if (port !== config.port) return false;
    const local = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
    if (config.hostname !== undefined) local.add(config.hostname);
    return local.has(host.toLowerCase());
}

function splitEndpoint(endpoint: string): [string, number | null] {
    const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(endpoint);
    if (match === null) return [endpoint, null];
    return [match[1] ?? endpoint, match[2] === undefined ? null : Number(match[2])];
}

export function registerAgentMethods(config: Readonly<Config>): void {
    method("agent.list", {
        requiresAuth: true,
        routable: false,
        parse: noParams,
        handle: () => ({ agents: summaries() }),
    });

    method("agent.add", {
        requiresAuth: true,
        routable: false,
        parse: (raw: unknown) => {
            const object = asObject(raw);
            return {
                url: str(object, "url", { min: 1, max: 512 }),
                username: str(object, "username", { min: 1, max: 128 }),
                password: str(object, "password", { min: 1, max: 512 }),
                name: optionalStr(object, "name", { max: 128 }),
            };
        },
        handle: async (_conn, params) => {
            const url = normaliseUrl(params.url);
            const endpoint = endpointOf(url);

            if (isSelf(config, endpoint)) {
                throw validation("that URL is this instance", { i18n: "cannotAddSelf" });
            }
            if (findByUrl(url) !== undefined) {
                throw conflict(`${url} is already configured`, { i18n: "agentAlreadyExists" });
            }

            // A real connect and login, so a typo becomes a form error rather than a host row that
            // is permanently offline.
            await testConnection(url, params.username, params.password);

            const row = insertAgent(url, params.username, params.password, params.name ?? "");
            pool.connectOne(row);
            pool.emitAgentList();
            log.info("agent", `added ${endpoint}`);
            return { endpoint };
        },
    });

    method("agent.remove", {
        requiresAuth: true,
        routable: false,
        parse: (raw: unknown) => ({ url: str(asObject(raw), "url", { min: 1, max: 512 }) }),
        handle: (_conn, params) => {
            const url = normaliseUrl(params.url);
            const row = findByUrl(url);
            if (row === undefined) throw notFound(`${url} is not configured`, { i18n: "agentNotFound" });

            pool.disconnect(endpointOf(url));
            deleteAgent(url);
            // The client drops the entries for any endpoint absent from the new agentList; there
            // is no stackList event for a host that no longer exists.
            pool.emitAgentList();
            log.info("agent", `removed ${endpointOf(url)}`);
            return { ok: true as const };
        },
    });

    method("agent.rename", {
        requiresAuth: true,
        routable: false,
        parse: (raw: unknown) => {
            const object = asObject(raw);
            return {
                url: str(object, "url", { min: 1, max: 512 }),
                name: str(object, "name", { max: 128 }),
            };
        },
        handle: (_conn, params) => {
            const url = normaliseUrl(params.url);
            if (renameAgent(url, params.name) === 0) {
                throw notFound(`${url} is not configured`, { i18n: "agentNotFound" });
            }
            pool.emitAgentList();
            return { ok: true as const };
        },
    });
}
