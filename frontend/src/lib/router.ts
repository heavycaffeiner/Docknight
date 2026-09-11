import type { MouseEvent } from "react";
import { createStore, useStore } from "./store.ts";

/** Only the path. Parameters are derived from it by `useParams`, so render stays pure. */
export const route = createStore<{ path: string }>({
    path: typeof location === "undefined" ? "/" : location.pathname,
});

/** Set by the server's `setup` event; the setup screen pre-empts every route while true. */
export const setupNeeded = createStore(false);

const beforeLeaveHooks = new Set<() => Promise<boolean> | boolean>();

export function registerBeforeLeave(hook: () => Promise<boolean> | boolean): () => void {
    beforeLeaveHooks.add(hook);
    return () => {
        beforeLeaveHooks.delete(hook);
    };
}

export function matchPattern(
    pattern: string,
    path: string,
): Record<string, string> | null {
    const patternSegments = pattern.split("/").filter(Boolean);
    const pathSegments = path.split("/").filter(Boolean);
    if (patternSegments.length !== pathSegments.length) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < patternSegments.length; i++) {
        const expected = patternSegments[i];
        const actual = pathSegments[i];
        if (expected === undefined || actual === undefined) return null;
        if (expected.startsWith(":")) {
            params[expected.slice(1)] = decodeURIComponent(actual);
        } else if (expected !== actual) {
            return null;
        }
    }
    return params;
}

export async function navigate(path: string, options: { replace?: boolean } = {}): Promise<void> {
    for (const hook of beforeLeaveHooks) {
        if (!(await hook())) return;
    }
    if (options.replace === true) {
        history.replaceState({}, "", path);
    } else {
        history.pushState({}, "", path);
    }
    route.set({ path });
}

export function routerInit(): () => void {
    const onPopState = (): void => route.set({ path: location.pathname });
    window.addEventListener("popstate", onPopState);
    route.set({ path: location.pathname });
    return () => window.removeEventListener("popstate", onPopState);
}

export function useRoute(): { path: string } {
    return useStore(route);
}

/**
 * Intercepts a plain anchor click so links stay real links (middle click, open in new tab, and
 * the status bar preview all keep working) while in-app navigation stays client side.
 */
export function linkHandler(path: string): (event: MouseEvent) => void {
    return (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void navigate(path);
    };
}
