import { Document, isMap, isSeq, parseDocument, type Node } from "yaml";

export interface ComposeConfig {
    services?: Record<string, unknown>;
    networks?: Record<string, unknown>;
    [key: string]: unknown;
}

function serialisedKeyValue(node: Node | null | undefined): string {
    if (node === null || node === undefined) return "";
    const doc = new Document(node);
    return doc.toString();
}

/**
 * Walk both documents in parallel, matching an item to its source by comparing the serialised
 * key and value (falling back to a key-only match when the value changed), and copy `comment`
 * and `commentBefore` on the node, its key, and its value, recursing into nested collections.
 * Matching by content rather than position keeps a comment attached to its service after a
 * service above it is deleted.
 */
function copyComments(target: Node | null | undefined, source: Node | null | undefined): void {
    if (target === null || target === undefined || source === null || source === undefined) return;

    if (isMap(target) && isMap(source)) {
        for (const targetPair of target.items) {
            const targetKeyStr = serialisedKeyValue(targetPair.key as Node);
            const targetValueStr = serialisedKeyValue(targetPair.value as Node);

            let match = source.items.find(
                (sourcePair) =>
                    serialisedKeyValue(sourcePair.key as Node) === targetKeyStr &&
                    serialisedKeyValue(sourcePair.value as Node) === targetValueStr,
            );
            if (match === undefined) {
                match = source.items.find(
                    (sourcePair) => serialisedKeyValue(sourcePair.key as Node) === targetKeyStr,
                );
            }
            if (match === undefined) continue;

            const targetNode = targetPair.value as Node | null;
            const sourceNode = match.value as Node | null;
            if (targetNode !== null && sourceNode !== null && "comment" in sourceNode) {
                if (sourceNode.comment !== undefined) targetNode.comment = sourceNode.comment;
                if (sourceNode.commentBefore !== undefined) targetNode.commentBefore = sourceNode.commentBefore;
            }
            const targetKey = targetPair.key as Node | null;
            const sourceKey = match.key as Node | null;
            if (targetKey !== null && sourceKey !== null && "comment" in sourceKey) {
                if (sourceKey.comment !== undefined) targetKey.comment = sourceKey.comment;
                if (sourceKey.commentBefore !== undefined) targetKey.commentBefore = sourceKey.commentBefore;
            }
            copyComments(targetNode, sourceNode);
        }
        return;
    }

    if (isSeq(target) && isSeq(source)) {
        for (const targetItem of target.items as Node[]) {
            const targetStr = serialisedKeyValue(targetItem);
            const sourceItem = (source.items as Node[]).find((item) => serialisedKeyValue(item) === targetStr);
            if (sourceItem === undefined) continue;
            if ("comment" in sourceItem) {
                if (sourceItem.comment !== undefined) targetItem.comment = sourceItem.comment;
                if (sourceItem.commentBefore !== undefined) targetItem.commentBefore = sourceItem.commentBefore;
            }
            copyComments(targetItem, sourceItem);
        }
    }
}

/**
 * Reserialise `config` to YAML while restoring the comments held in `previous`. Comments are
 * matched by node content rather than by position, so an insertion or a deletion elsewhere in
 * the document does not move them.
 */
export function serialiseWithComments(
    config: ComposeConfig,
    previous: Document | null,
): { text: string; doc: Document } {
    const next = new Document(config);
    if (previous !== null) copyComments(next.contents, previous.contents);
    return { text: next.toString(), doc: next };
}

const VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-?])?([^}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

export interface ExpansionWarning {
    variable: string;
    message: string;
}

function expandString(value: string, env: Record<string, string>, warnings: ExpansionWarning[]): string {
    return value.replace(VAR_PATTERN, (match, braced: string, op: string, rest: string, bare: string) => {
        const name = braced ?? bare;
        if (op === undefined) {
            return env[name] ?? "";
        }
        if (op === ":-") {
            return env[name] !== undefined && env[name] !== "" ? env[name] : rest;
        }
        if (op === "-") {
            return name in env ? (env[name] as string) : rest;
        }
        if (op === ":?" || op === "?") {
            if (env[name] === undefined || (op === ":?" && env[name] === "")) {
                warnings.push({ variable: name, message: rest !== "" ? rest : `${name} is required` });
                return "";
            }
            return env[name] as string;
        }
        return match;
    });
}

function expandNode(value: unknown, env: Record<string, string>, warnings: ExpansionWarning[]): unknown {
    if (typeof value === "string") return expandString(value, env, warnings);
    if (Array.isArray(value)) return value.map((item) => expandNode(item, env, warnings));
    if (typeof value === "object" && value !== null) {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(value)) out[key] = expandNode(v, env, warnings);
        return out;
    }
    return value;
}

/**
 * Expand ${VAR} style references in every scalar of `yamlText` using `env`, and return the
 * resulting structure. Display only; the file on disk is never rewritten.
 */
export function expandForDisplay(
    yamlText: string,
    env: Record<string, string>,
): { config: ComposeConfig; warnings: ExpansionWarning[] } {
    const doc = parseDocument(yamlText);
    const warnings: ExpansionWarning[] = [];
    if (doc.errors.length > 0) return { config: {}, warnings };
    const expanded = expandNode(doc.toJS(), env, warnings) as ComposeConfig;
    return { config: expanded, warnings };
}

/**
 * Parse one compose port entry into a link target and a display label. Returns null when the
 * entry does not parse, in which case the caller renders plain text.
 */
export function parsePort(entry: string, hostname: string): { url: string; display: string } | null {
    // Normalise the "0.0.0.0:8080->8080/tcp" listing form to "8080:8080/tcp" first.
    const arrowMatch = /^(?:([\d.a-fA-F:]+):)?(\d+)->(\d+)(?:\/(tcp|udp))?$/.exec(entry);
    const normalised = arrowMatch
        ? `${arrowMatch[2]}:${arrowMatch[3]}${arrowMatch[4] !== undefined ? `/${arrowMatch[4]}` : ""}`
        : entry;

    // [host_ip ":"] host_port ["-" host_range_end] [":" container_port ...] ["/" proto]
    const match =
        /^(?:([\d.a-fA-F:]+):)?(\d+)(?:-(\d+))?(?::(\d+)(?:-(\d+))?)?(?:\/(tcp|udp))?$/.exec(normalised);
    if (match === null) return null;
    const hostPort = match[2];
    if (hostPort === undefined) return null;
    const scheme = hostPort === "443" ? "https" : "http";
    return { url: `${scheme}://${hostname}:${hostPort}`, display: entry };
}

/** Parse a `.env`-style buffer: blank lines and #-comments skipped, KEY=value pairs kept. */
export function parseEnv(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (line === "" || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        const quote = value[0];
        if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
            value = value.slice(1, -1);
            if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
        }
        out[key] = value;
    }
    return out;
}

/** Parse a compose YAML document, throwing with the first error's message on invalid input. */
export function parseCompose(yamlText: string): { doc: Document; config: ComposeConfig; error: string | null } {
    const doc = parseDocument(yamlText);
    if (doc.errors.length > 0) {
        return { doc, config: {}, error: doc.errors[0]?.message ?? "invalid YAML" };
    }
    const config = doc.toJS() as ComposeConfig;
    if (config.services === undefined) config.services = {};
    return { doc, config, error: null };
}
