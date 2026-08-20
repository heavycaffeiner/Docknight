import { AppError } from "../../common/errors.ts";
import { all, one, run } from "../db/index.ts";

export interface AgentRow {
    id: number;
    url: string;
    username: string;
    secret: string;
    name: string | null;
    active: number;
}

function toRow(row: AgentRow): AgentRow {
    return row;
}

/**
 * Normalise an agent URL: lowercase the scheme and host, drop the default port for that
 * scheme, drop a trailing slash on the path, and drop search and hash. Two URLs that reach the
 * same host end up identical, so the UNIQUE constraint on the url column actually catches
 * duplicates.
 *
 * @throws AppError("validation", ..., "invalidAgentUrl") when the string does not parse as a
 *         URL or its scheme is neither http nor https.
 */
export function normaliseUrl(raw: string): string {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new AppError("validation", `${raw} is not a valid URL`, "invalidAgentUrl");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new AppError("validation", `${raw} must be http or https`, "invalidAgentUrl");
    }
    // `origin` already lowercases the scheme and host and drops the default port for the
    // scheme; only the path needs its own trailing slash trimmed, and search/hash are dropped.
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return parsed.origin + path;
}

/** The host:port an agent is addressed by, computed from its normalised URL. */
export function deriveEndpoint(url: string): string {
    return new URL(url).host;
}

export const agentStore = {
    list(): AgentRow[] {
        return all<AgentRow>("SELECT id, url, username, secret, name, active FROM agent").map(toRow);
    },

    /**
     * @throws AppError("conflict", ..., "agentAlreadyExists") when a row with this normalised
     *         URL already exists.
     */
    add(url: string, username: string, encryptedSecret: string, name: string | undefined): AgentRow {
        let insertedId: number;
        try {
            const result = run(
                "INSERT INTO agent (url, username, secret, name) VALUES (:url, :username, :secret, :name)",
                { url, username, secret: encryptedSecret, name: name ?? null },
            );
            insertedId = result.lastInsertRowid;
        } catch (error) {
            if (error instanceof Error && error.message.includes("UNIQUE")) {
                throw new AppError("conflict", `an agent for ${url} already exists`, "agentAlreadyExists");
            }
            throw error;
        }
        const row = one<AgentRow>(
            "SELECT id, url, username, secret, name, active FROM agent WHERE id = :id",
            { id: insertedId },
        );
        if (row === undefined) throw new AppError("internal", "agent insert did not return a row");
        return toRow(row);
    },

    remove(url: string): void {
        run("DELETE FROM agent WHERE url = :url", { url });
    },

    rename(url: string, name: string): void {
        run("UPDATE agent SET name = :name WHERE url = :url", { url, name: name === "" ? null : name });
    },

    byUrl(url: string): AgentRow | undefined {
        const row = one<AgentRow>(
            "SELECT id, url, username, secret, name, active FROM agent WHERE url = :url",
            { url },
        );
        return row === undefined ? undefined : toRow(row);
    },
};
