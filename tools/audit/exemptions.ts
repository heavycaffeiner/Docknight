import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Exemption } from "./contract.ts";

export const EXEMPTIONS_PATH = fileURLToPath(
    new URL("../../design/exemptions.json", import.meta.url),
);

/** Consecutive runs in which each entry silenced nothing. Generated, never committed. */
export const USAGE_PATH = fileURLToPath(
    new URL("../../design/exemption-usage.json", import.meta.url),
);

/** An entry that silences nothing for this many runs in a row is dead and fails the run. */
export const STALE_AFTER_RUNS = 2;

const SELECTOR_PATTERN = /^\[data-audit-id=(?:'[^']+'|"[^"]+")\]$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fail(index: number, problem: string): never {
    throw new Error(`design/exemptions.json entry ${index}: ${problem}`);
}

function text(value: unknown, index: number, field: string): string {
    if (typeof value !== "string" || value.trim() === "") fail(index, `${field} must be a non-empty string`);
    return value;
}

function normalise(value: string): string {
    return value.toLowerCase().replace(/[^a-z]/g, "");
}

function parseEntry(raw: unknown, index: number, seen: Set<string>): Exemption {
    if (typeof raw !== "object" || raw === null) fail(index, "must be an object");
    const entry = raw as Record<string, unknown>;

    const id = text(entry.id, index, "id");
    if (seen.has(id)) fail(index, `duplicate id ${id}`);
    seen.add(id);

    const rule = text(entry.rule, index, "rule");
    const selector = text(entry.selector, index, "selector");
    if (!SELECTOR_PATTERN.test(selector)) {
        fail(index, "selector must be [data-audit-id='...'], so a refactor cannot widen it");
    }

    const reason = text(entry.reason, index, "reason");
    if (normalise(reason) === normalise(rule)) fail(index, "reason repeats the rule name");

    const maxMatches = entry.maxMatches;
    if (typeof maxMatches !== "number" || !Number.isInteger(maxMatches) || maxMatches < 1) {
        fail(index, "maxMatches must be an integer of at least 1");
    }

    const approvedBy = text(entry.approvedBy, index, "approvedBy");
    const approvedOn = text(entry.approvedOn, index, "approvedOn");
    if (!DATE_PATTERN.test(approvedOn)) fail(index, "approvedOn must be YYYY-MM-DD");

    return { id, rule, selector, reason, maxMatches, approvedBy, approvedOn };
}

/** Read and validate the exemption file. Anything malformed fails the run rather than passing. */
export async function loadExemptions(path: string = EXEMPTIONS_PATH): Promise<Exemption[]> {
    let body: string;
    try {
        body = await readFile(path, "utf8");
    } catch {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch (thrown) {
        throw new Error(`design/exemptions.json is not valid JSON: ${(thrown as Error).message}`, {
            cause: thrown,
        });
    }

    const file = parsed as { version?: unknown; entries?: unknown };
    if (file.version !== 1) throw new Error("design/exemptions.json: version must be 1");
    if (!Array.isArray(file.entries)) throw new Error("design/exemptions.json: entries must be an array");

    const seen = new Set<string>();
    return file.entries.map((entry, index) => parseEntry(entry, index, seen));
}

export type UsageCounts = Record<string, number>;

export async function loadUsage(path: string = USAGE_PATH): Promise<UsageCounts> {
    try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        if (typeof parsed !== "object" || parsed === null) return {};
        const counts: UsageCounts = {};
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === "number" && Number.isInteger(value) && value >= 0) counts[id] = value;
        }
        return counts;
    } catch {
        return {};
    }
}

/**
 * Advance the zero-match streak for every entry. An id that matched this run resets to zero, and
 * one that has gone missing entirely is dropped so a removed entry leaves no residue.
 */
export function nextUsage(
    previous: UsageCounts,
    totals: Record<string, number>,
    ids: string[],
): UsageCounts {
    const counts: UsageCounts = {};
    for (const id of ids) {
        counts[id] = (totals[id] ?? 0) > 0 ? 0 : (previous[id] ?? 0) + 1;
    }
    return counts;
}

export function staleEntries(counts: UsageCounts): string[] {
    return Object.entries(counts)
        .filter(([, streak]) => streak >= STALE_AFTER_RUNS)
        .map(([id]) => id);
}

export async function saveUsage(counts: UsageCounts, path: string = USAGE_PATH): Promise<void> {
    await writeFile(path, `${JSON.stringify(counts, null, 2)}\n`, "utf8");
}
