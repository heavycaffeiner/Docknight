import type { Component } from "svelte";

export type Guard = "authenticated" | "needsSetup";

interface RouteDefinition {
    pattern: string;
    guard: Guard;
    load: () => Promise<{ default: Component<Record<string, never>> }>;
    /** i18n key for the document title and the announced heading. */
    titleKey: string;
}

/** Screens are loaded with dynamic import(), which is what makes Vite split them into chunks. */
const ROUTES: RouteDefinition[] = [
    { pattern: "/", guard: "authenticated", titleKey: "navHome", load: () => import("./pages/Dashboard.svelte") },
    { pattern: "/compose", guard: "authenticated", titleKey: "pageNewStack", load: () => import("./pages/Stack.svelte") },
    { pattern: "/compose/:name", guard: "authenticated", titleKey: "pageStack", load: () => import("./pages/Stack.svelte") },
    { pattern: "/compose/:name/:endpoint", guard: "authenticated", titleKey: "pageStack", load: () => import("./pages/Stack.svelte") },
    { pattern: "/terminal/:stack/:service/:type", guard: "authenticated", titleKey: "pageTerminal", load: () => import("./pages/ContainerTerminal.svelte") },
    { pattern: "/terminal/:stack/:service/:type/:endpoint", guard: "authenticated", titleKey: "pageTerminal", load: () => import("./pages/ContainerTerminal.svelte") },
    { pattern: "/console", guard: "authenticated", titleKey: "pageConsole", load: () => import("./pages/Console.svelte") },
    { pattern: "/console/:endpoint", guard: "authenticated", titleKey: "pageConsole", load: () => import("./pages/Console.svelte") },
    { pattern: "/settings/:section", guard: "authenticated", titleKey: "pageSettings", load: () => import("./pages/Settings.svelte") },
    { pattern: "/setup", guard: "needsSetup", titleKey: "pageSetup", load: () => import("./pages/Setup.svelte") },
];

export interface ActiveRoute {
    path: string;
    params: Record<string, string>;
    component: Component<Record<string, never>> | null;
    guard: Guard;
    titleKey: string;
    loading: boolean;
    notFound: boolean;
}

export const route = $state<ActiveRoute>({
    path: "/",
    params: {},
    component: null,
    guard: "authenticated",
    titleKey: "navHome",
    loading: true,
    notFound: false,
});

/** Transient state handed between screens, such as YAML produced by the docker run converter. */
export const handoff = $state<{ composeYAML: string | null }>({ composeYAML: null });

interface Match {
    definition: RouteDefinition;
    params: Record<string, string>;
}

function matchRoute(path: string): Match | null {
    const segments = path.replace(/\/+$/, "").split("/").filter((part) => part !== "");
    for (const definition of ROUTES) {
        const patternSegments = definition.pattern
            .split("/")
            .filter((part) => part !== "");
        if (patternSegments.length !== segments.length) continue;

        const params: Record<string, string> = {};
        let ok = true;
        for (const [index, pattern] of patternSegments.entries()) {
            const actual = segments[index] as string;
            if (pattern.startsWith(":")) params[pattern.slice(1)] = decodeURIComponent(actual);
            else if (pattern !== actual) {
                ok = false;
                break;
            }
        }
        if (ok) return { definition, params };
    }
    return null;
}

const beforeLeaveHooks = new Set<() => boolean | Promise<boolean>>();

/** Register a guard that may block navigation away from the current screen. */
export function onBeforeLeave(hook: () => boolean | Promise<boolean>): () => void {
    beforeLeaveHooks.add(hook);
    return () => beforeLeaveHooks.delete(hook);
}

async function mayLeave(): Promise<boolean> {
    for (const hook of [...beforeLeaveHooks]) {
        if (!(await hook())) return false;
    }
    return true;
}

async function render(path: string): Promise<void> {
    const match = matchRoute(path);
    route.path = path;

    if (match === null) {
        route.params = {};
        route.component = null;
        route.notFound = true;
        route.loading = false;
        return;
    }

    route.params = match.params;
    route.guard = match.definition.guard;
    route.titleKey = match.definition.titleKey;
    route.notFound = false;
    route.loading = true;
    const module = await match.definition.load();
    route.component = module.default;
    route.loading = false;
}

/** Push a new history entry and render the matching route. Runs beforeLeave hooks first. */
export async function navigate(path: string, opts?: { replace?: boolean }): Promise<void> {
    if (path === route.path) return;
    if (!(await mayLeave())) return;
    beforeLeaveHooks.clear();
    if (opts?.replace === true) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    await render(path);
}

export function startRouter(): void {
    window.addEventListener("popstate", () => {
        void mayLeave().then((allowed) => {
            if (!allowed) {
                history.pushState(null, "", route.path);
                return;
            }
            beforeLeaveHooks.clear();
            void render(location.pathname);
        });
    });
    void render(location.pathname);
}
