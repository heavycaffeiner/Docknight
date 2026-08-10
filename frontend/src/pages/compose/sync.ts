import { Document, isCollection, isPair, isScalar, parseDocument, type Node } from "yaml";

export interface ComposeService {
    image?: string;
    ports?: string[];
    volumes?: string[];
    environment?: string[] | Record<string, string>;
    restart?: string;
    depends_on?: string[] | Record<string, unknown>;
    container_name?: string;
    networks?: string[] | Record<string, unknown>;
    [key: string]: unknown;
}

export interface ComposeConfig {
    services: Record<string, ComposeService>;
    networks?: Record<string, unknown>;
    volumes?: Record<string, unknown>;
    "x-docknight"?: { urls?: string[] };
    [key: string]: unknown;
}

export function emptyConfig(): ComposeConfig {
    return { services: {} };
}

/** Parse a buffer into the structured view, defaulting `services` to an empty mapping. */
export function parseConfig(yamlText: string): { doc: Document; config: ComposeConfig } | null {
    const doc = parseDocument(yamlText);
    if (doc.errors.length > 0) return null;
    const root: unknown = doc.toJS();
    if (root === null || typeof root !== "object" || Array.isArray(root)) return null;
    const config = root as ComposeConfig;
    if (config.services === undefined || config.services === null) config.services = {};
    return { doc, config };
}

export function firstParseError(yamlText: string): string | null {
    const doc = parseDocument(yamlText);
    return doc.errors.length > 0 ? (doc.errors[0]?.message ?? "invalid YAML") : null;
}

function nodeKeyText(node: unknown): string {
    if (isPair(node)) return String(isScalar(node.key) ? node.key.value : node.key);
    if (isScalar(node)) return String(node.value);
    return "";
}

interface Commented {
    comment?: string | null;
    commentBefore?: string | null;
}

function copyCommentFields(target: Commented, source: Commented): void {
    if (source.comment != null) target.comment = source.comment;
    if (source.commentBefore != null) target.commentBefore = source.commentBefore;
}

/**
 * Walk both documents in parallel, matching an item to its source by comparing the serialised key
 * and value, and copy comments on the node, its key and its value. Matching by content rather
 * than by position keeps a comment attached to its service after a service above it is deleted.
 */
function copyComments(target: unknown, source: unknown): void {
    if (target === null || source === null || target === undefined || source === undefined) return;

    if (isPair(target) && isPair(source)) {
        copyCommentFields(target as Commented, source as Commented);
        if (target.key !== null && source.key !== null) {
            copyCommentFields(target.key as Commented, source.key as Commented);
        }
        copyComments(target.value, source.value);
        return;
    }

    if (isCollection(target) && isCollection(source)) {
        copyCommentFields(target as Commented, source as Commented);

        const used = new Set<number>();
        const sourceItems = source.items as unknown[];

        target.items.forEach((item: unknown) => {
            const key = isPair(item) ? nodeKeyText(item) : null;
            const serialised = key === null ? serialiseItem(item) : null;

            const index = sourceItems.findIndex((candidate, position) => {
                if (used.has(position)) return false;
                if (key !== null) return isPair(candidate) && nodeKeyText(candidate) === key;
                return serialiseItem(candidate) === serialised;
            });
            if (index < 0) return;
            used.add(index);
            copyComments(item, sourceItems[index]);
        });
        return;
    }

    if (isScalar(target) && isScalar(source)) copyCommentFields(target as Commented, source as Commented);
}

function serialiseItem(item: unknown): string {
    if (isScalar(item)) return String(item.value);
    try {
        return JSON.stringify((item as Node & { toJSON?: () => unknown }).toJSON?.() ?? item);
    } catch {
        return "";
    }
}

/**
 * Reserialise `config` to YAML while restoring the comments held in `previous`.
 */
export function serialiseWithComments(
    config: ComposeConfig,
    previous: Document | null,
): { text: string; doc: Document } {
    const next = new Document(config);
    if (previous !== null) {
        copyComments(next.contents, previous.contents);
        if (previous.comment != null) next.comment = previous.comment;
        if (previous.commentBefore != null) next.commentBefore = previous.commentBefore;
    }
    return { text: next.toString({ lineWidth: 0 }), doc: next };
}

const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?[-?]([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

export interface ExpansionResult {
    config: ComposeConfig;
    /** Variables that used the `:?message` form and were not set. */
    warnings: string[];
}

function expandString(
    text: string,
    env: Record<string, string>,
    warnings: string[],
): string {
    return text.replace(VARIABLE, (whole, braced: string | undefined, fallback: string | undefined, bare: string | undefined) => {
        const name = braced ?? bare;
        if (name === undefined) return whole;
        const value = env[name];
        if (value !== undefined && value !== "") return value;
        if (whole.includes("?") && !whole.includes(":-") && !whole.includes("-}")) {
            warnings.push(name);
            return "";
        }
        // An unset variable with no default expands to the empty string.
        return fallback ?? "";
    });
}

function expandValue(value: unknown, env: Record<string, string>, warnings: string[]): unknown {
    if (typeof value === "string") return expandString(value, env, warnings);
    if (Array.isArray(value)) return value.map((item) => expandValue(item, env, warnings));
    if (value !== null && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            out[key] = expandValue(item, env, warnings);
        }
        return out;
    }
    return value;
}

/**
 * Expand ${VAR} style references in every scalar and return the resulting structure. Display
 * only; the file on disk keeps its variables.
 */
export function expandForDisplay(yamlText: string, env: Record<string, string>): ExpansionResult {
    const parsed = parseConfig(yamlText);
    const warnings: string[] = [];
    if (parsed === null) return { config: emptyConfig(), warnings };
    const expanded = expandValue(parsed.config, env, warnings) as ComposeConfig;
    if (expanded.services === undefined) expanded.services = {};
    return { config: expanded, warnings };
}

/**
 * Parse one compose port entry into a link target and a display label. Returns null when the
 * entry does not parse, in which case the caller renders plain text.
 */
export function parsePort(
    entry: string,
    hostname: string,
): { url: string; display: string } | null {
    const text = entry.trim();
    if (text === "") return null;

    // The "0.0.0.0:8080->8080/tcp" form container listings print.
    const arrow = text.includes("->") ? (text.split("->")[0] ?? "") : text;
    const withoutProtocol = arrow.split("/")[0] ?? "";
    const parts = withoutProtocol.split(":");

    let hostPart: string;
    if (parts.length === 1) hostPart = parts[0] as string;
    else if (parts.length === 2) hostPart = parts[0] as string;
    else hostPart = parts[parts.length - 2] as string;

    // A range takes its first member.
    const first = (hostPart.split("-")[0] ?? "").trim();
    if (!/^\d+$/.test(first)) return null;
    const port = Number(first);
    if (port < 1 || port > 65535) return null;

    const scheme = port === 443 ? "https" : "http";
    const host = hostname === "" ? location.hostname : hostname;
    const omitPort = (scheme === "https" && port === 443) || (scheme === "http" && port === 80);
    return {
        url: omitPort ? `${scheme}://${host}` : `${scheme}://${host}:${port}`,
        display: text,
    };
}

/** Environment can be a list of KEY=value or a mapping; the editor works in the list form. */
export function environmentAsList(value: ComposeService["environment"]): string[] {
    if (value === undefined) return [];
    if (Array.isArray(value)) return value.map(String);
    return Object.entries(value).map(([key, item]) => `${key}=${String(item)}`);
}

export function listAsStringArray(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === "object") return Object.keys(value as Record<string, unknown>);
    return [String(value)];
}

/** Drop empty rows so an unfinished entry never reaches the compose file. */
export function pruneList(values: string[]): string[] | undefined {
    const cleaned = values.map((value) => value.trim()).filter((value) => value !== "");
    return cleaned.length === 0 ? undefined : cleaned;
}
