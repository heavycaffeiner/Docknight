import type { StackSummary } from "../../../../common/stack.ts";
import { on } from "../connection.svelte.ts";

const state = $state<{ byKey: Record<string, StackSummary>; loaded: boolean }>({
    byKey: {},
    loaded: false,
});

export const stacks: { readonly byKey: Record<string, StackSummary>; readonly loaded: boolean } = {
    get byKey() {
        return state.byKey;
    },
    get loaded() {
        return state.loaded;
    },
};

function keyFor(name: string, endpoint: string): string {
    return `${name} ${endpoint}`;
}

/** Replace the snapshot for one endpoint. Entries for other endpoints are untouched. */
export function applyStackList(endpoint: string, list: Record<string, StackSummary>): void {
    const suffix = ` ${endpoint}`;
    const next: Record<string, StackSummary> = {};
    for (const [key, value] of Object.entries(state.byKey)) {
        if (!key.endsWith(suffix)) next[key] = value;
    }
    for (const [name, summary] of Object.entries(list)) {
        next[keyFor(name, endpoint)] = summary;
    }
    state.byKey = next;
    state.loaded = true;
}

/** Drop every entry belonging to an endpoint. Called when an endpoint disappears from agentList. */
export function dropEndpoint(endpoint: string): void {
    const suffix = ` ${endpoint}`;
    const next: Record<string, StackSummary> = {};
    for (const [key, value] of Object.entries(state.byKey)) {
        if (!key.endsWith(suffix)) next[key] = value;
    }
    state.byKey = next;
}

export function resetStacksStore(): void {
    state.byKey = {};
    state.loaded = false;
}

on("stackList", (endpoint, data) => {
    applyStackList(endpoint, data.stacks as Record<string, StackSummary>);
});
