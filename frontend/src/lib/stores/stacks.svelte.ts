import type { StackSummary } from "../../../../common/stack.ts";
import { on } from "../connection.svelte.ts";

export interface StacksStore {
    byKey: Record<string, StackSummary>;
    loaded: boolean;
}

export const stacks = $state<StacksStore>({
    byKey: {},
    loaded: false,
});

export function applyStackList(endpoint: string, list: Record<string, StackSummary>): void {
    const suffix = ` ${endpoint}`;
    for (const key of Object.keys(stacks.byKey)) {
        if (key.endsWith(suffix)) {
            delete stacks.byKey[key];
        }
    }
    for (const [name, summary] of Object.entries(list)) {
        stacks.byKey[`${name} ${endpoint}`] = summary;
    }
    stacks.loaded = true;
}

export function dropEndpoint(endpoint: string): void {
    const suffix = ` ${endpoint}`;
    for (const key of Object.keys(stacks.byKey)) {
        if (key.endsWith(suffix)) {
            delete stacks.byKey[key];
        }
    }
}

export function clearStacks(): void {
    stacks.byKey = {};
    stacks.loaded = false;
}

on("stackList", (payload: unknown, endpoint: string) => {
    const data = payload as { stacks?: Record<string, StackSummary> } | undefined;
    if (data?.stacks !== undefined) {
        applyStackList(endpoint, data.stacks);
    }
});
