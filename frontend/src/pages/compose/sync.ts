import { Document, parseDocument, isMap, isSeq, isScalar } from "yaml";

export interface ComposeConfig {
    services?: Record<string, Record<string, unknown>>;
    networks?: Record<string, Record<string, unknown>>;
    volumes?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
}

export interface ExpansionWarning {
    variable: string;
    message: string;
}

export function parseEnv(text: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (line === "" || line.startsWith("#")) continue;
        const eqIdx = line.indexOf("=");
        if (eqIdx === -1) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        env[key] = val;
    }
    return env;
}

export function parsePort(entry: string, hostname: string): { url: string; display: string } | null {
    const arrowMatch = /^(?:([\d.a-fA-F:]+):)?(\d+)->(\d+)(?:\/(tcp|udp))?$/.exec(entry);
    const normalised = arrowMatch !== null
        ? `${arrowMatch[2]}:${arrowMatch[3]}${arrowMatch[4] !== undefined ? `/${arrowMatch[4]}` : ""}`
        : entry;

    const parts = normalised.split(":");
    if (parts.length >= 2) {
        const hostPort = parts[parts.length - 2];
        if (hostPort !== undefined && /^\d+$/.test(hostPort)) {
            const scheme = hostPort === "443" ? "https" : "http";
            return {
                url: `${scheme}://${hostname}:${hostPort}`,
                display: normalised,
            };
        }
    }
    return null;
}

function expandString(
    val: string,
    env: Record<string, string>,
    warnings: ExpansionWarning[],
): string {
    return val.replace(/\$(?:\{([^}]+)\}|([a-zA-Z_][a-zA-Z0-9_]*))/g, (_, braced: string | undefined, bare: string | undefined) => {
        const expr = braced ?? bare ?? "";
        if (expr === "") return "";

        const colonDash = expr.indexOf(":-");
        if (colonDash !== -1) {
            const v = expr.slice(0, colonDash);
            const def = expr.slice(colonDash + 2);
            return env[v] !== undefined && env[v] !== "" ? (env[v] as string) : def;
        }

        const dash = expr.indexOf("-");
        if (dash !== -1) {
            const v = expr.slice(0, dash);
            const def = expr.slice(dash + 1);
            return env[v] !== undefined ? (env[v] as string) : def;
        }

        const colonQuestion = expr.indexOf(":?");
        if (colonQuestion !== -1) {
            const v = expr.slice(0, colonQuestion);
            const msg = expr.slice(colonQuestion + 2);
            if (env[v] === undefined || env[v] === "") {
                warnings.push({ variable: v, message: msg || `Variable ${v} is not set` });
                return "";
            }
            return env[v] as string;
        }

        return env[expr] ?? "";
    });
}

function expandNode(node: unknown, env: Record<string, string>, warnings: ExpansionWarning[]): unknown {
    if (typeof node === "string") {
        return expandString(node, env, warnings);
    }
    if (Array.isArray(node)) {
        return node.map((item) => expandNode(item, env, warnings));
    }
    if (node !== null && typeof node === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node)) {
            out[k] = expandNode(v, env, warnings);
        }
        return out;
    }
    return node;
}

export function expandForDisplay(
    yamlText: string,
    env: Record<string, string>,
): { config: ComposeConfig; warnings: ExpansionWarning[] } {
    const warnings: ExpansionWarning[] = [];
    try {
        const doc = parseDocument(yamlText);
        if (doc.errors.length > 0) return { config: {}, warnings };
        const js = doc.toJS();
        if (js === null || typeof js !== "object") return { config: {}, warnings };
        const expanded = expandNode(js, env, warnings) as ComposeConfig;
        return { config: expanded, warnings };
    } catch {
        return { config: {}, warnings };
    }
}

export function parseCompose(text: string): { config: ComposeConfig; doc: Document | null; error: string | null } {
    try {
        const doc = parseDocument(text);
        if (doc.errors.length > 0 && doc.errors[0] !== undefined) {
            return { config: {}, doc: null, error: doc.errors[0].message };
        }
        const js = doc.toJS();
        const config = (typeof js === "object" && js !== null ? js : {}) as ComposeConfig;
        if (config.services === undefined || config.services === null) {
            config.services = {};
        }
        return { config, doc, error: null };
    } catch (e) {
        return { config: {}, doc: null, error: e instanceof Error ? e.message : "Invalid YAML" };
    }
}

interface Commentable {
    commentBefore?: string;
    comment?: string;
}

function copyComments(target: unknown, source: unknown): void {
    if (isMap(target) && isMap(source)) {
        for (const targetPair of target.items) {
            const targetKey = String(targetPair.key);
            for (const sourcePair of source.items) {
                if (String(sourcePair.key) === targetKey) {
                    const s = sourcePair as Commentable;
                    const t = targetPair as Commentable;
                    if (s.commentBefore !== undefined) t.commentBefore = s.commentBefore;
                    if (s.comment !== undefined) t.comment = s.comment;
                    copyComments(targetPair.value, sourcePair.value);
                    break;
                }
            }
        }
    } else if (isSeq(target) && isSeq(source)) {
        for (let i = 0; i < target.items.length && i < source.items.length; i++) {
            const tItem = target.items[i];
            const sItem = source.items[i];
            if (isScalar(tItem) && isScalar(sItem)) {
                if (sItem.commentBefore !== undefined) tItem.commentBefore = sItem.commentBefore;
                if (sItem.comment !== undefined) tItem.comment = sItem.comment;
            }
        }
    }
}

export function serialiseWithComments(
    config: ComposeConfig,
    previousDoc: Document | null,
): { text: string; doc: Document } {
    const doc = new Document(config);
    if (previousDoc !== null) {
        copyComments(doc.contents, previousDoc.contents);
    }
    return { text: doc.toString(), doc };
}
