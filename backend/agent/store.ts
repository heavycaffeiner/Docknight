import { validation } from "../../common/errors.ts";
import type { AgentSummary } from "../../common/protocol.ts";
import { all, one, run } from "../db/index.ts";
import { encryptSecret } from "./crypto.ts";

export interface AgentRow {
    id: number;
    url: string;
    username: string;
    secret: string;
    name: string | null;
    active: number;
}

/**
 * Normalise at insert: scheme lowercased, default port removed, trailing slash removed. A
 * malformed URL therefore fails at `agent.add` rather than later inside a list operation.
 */
export function normaliseUrl(raw: string): string {
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        throw validation(`${JSON.stringify(raw)} is not a URL`, { i18n: "invalidAgentUrl" });
    }
    const scheme = url.protocol.toLowerCase();
    if (scheme !== "http:" && scheme !== "https:") {
        throw validation(`${url.protocol} is not http or https`, { i18n: "invalidAgentUrl" });
    }
    if ((scheme === "http:" && url.port === "80") || (scheme === "https:" && url.port === "443")) {
        url.port = "";
    }
    if (url.hostname === "") {
        throw validation("the URL has no host", { i18n: "invalidAgentUrl" });
    }
    return `${scheme}//${url.host}`;
}

/** Derived, never stored. */
export function endpointOf(normalisedUrl: string): string {
    return new URL(normalisedUrl).host;
}

export function listAgents(): AgentRow[] {
    return all<AgentRow>("SELECT * FROM agent ORDER BY id");
}

export function activeAgents(): AgentRow[] {
    return all<AgentRow>("SELECT * FROM agent WHERE active = 1 ORDER BY id");
}

export function findByUrl(url: string): AgentRow | undefined {
    return one<AgentRow>("SELECT * FROM agent WHERE url = :url", { url });
}

export function insertAgent(
    url: string,
    username: string,
    password: string,
    name: string,
): AgentRow {
    run(
        "INSERT INTO agent(url, username, secret, name, active) VALUES (:url, :username, :secret, :name, 1)",
        { url, username, secret: encryptSecret(password), name },
    );
    const row = findByUrl(url);
    if (row === undefined) throw new Error("the inserted host row disappeared");
    return row;
}

export function deleteAgent(url: string): number {
    return run("DELETE FROM agent WHERE url = :url", { url }).changes;
}

export function renameAgent(url: string, name: string): number {
    return run("UPDATE agent SET name = :name WHERE url = :url", { name, url }).changes;
}

/** The wire shape. Never carries the password. */
export function toSummary(row: AgentRow): AgentSummary {
    return {
        url: row.url,
        endpoint: endpointOf(row.url),
        username: row.username,
        name: row.name ?? "",
    };
}

/** Every configured host plus the synthetic local entry keyed by the empty string. */
export function summaries(): Record<string, AgentSummary> {
    const out: Record<string, AgentSummary> = {
        "": { url: "", endpoint: "", username: "", name: "" },
    };
    for (const row of listAgents()) out[endpointOf(row.url)] = toSummary(row);
    return out;
}
