import { stackKey, type StackSummary } from "$common/stack.ts";
import { request } from "../connection.svelte.ts";

export interface StackEntry extends StackSummary {
    endpoint: string;
}

/** Keyed by `${name} ${endpoint}` so two hosts may share a stack name. */
export const stacks = $state<{ byKey: Record<string, StackEntry>; loaded: boolean }>({
    byKey: {},
    loaded: false,
});

/** Replace the snapshot for one endpoint. Entries for other endpoints are untouched. */
export function applyStackList(endpoint: string, list: Record<string, StackSummary>): void {
    const next: Record<string, StackEntry> = {};
    for (const [key, entry] of Object.entries(stacks.byKey)) {
        if (entry.endpoint !== endpoint) next[key] = entry;
    }
    for (const summary of Object.values(list)) {
        next[stackKey(summary.name, endpoint)] = { ...summary, endpoint };
    }
    stacks.byKey = next;
    stacks.loaded = true;
}

/**
 * Drop every entry belonging to an endpoint. Called when an endpoint disappears from agentList,
 * which is the only signal that a host was removed.
 */
export function dropEndpoint(endpoint: string): void {
    const next: Record<string, StackEntry> = {};
    for (const [key, entry] of Object.entries(stacks.byKey)) {
        if (entry.endpoint !== endpoint) next[key] = entry;
    }
    stacks.byKey = next;
}

/** Keep only the endpoints the server still knows about. */
export function retainEndpoints(endpoints: readonly string[]): void {
    const keep = new Set(endpoints);
    for (const entry of Object.values(stacks.byKey)) {
        if (!keep.has(entry.endpoint)) dropEndpoint(entry.endpoint);
    }
}

export function clearStacks(): void {
    stacks.byKey = {};
    stacks.loaded = false;
}

/** Ask a host to rescan and re-emit. Fire and forget; the event carries the result. */
export function refresh(endpoint: string): void {
    void request(endpoint, "stack.list", undefined).catch(() => undefined);
}

export function stackList(): StackEntry[] {
    return Object.values(stacks.byKey).sort(
        (a, b) => a.name.localeCompare(b.name) || a.endpoint.localeCompare(b.endpoint),
    );
}

export function findStack(name: string, endpoint: string): StackEntry | undefined {
    return stacks.byKey[stackKey(name, endpoint)];
}
