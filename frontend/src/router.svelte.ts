import type { Component } from "svelte";
import { session } from "./lib/stores/session.svelte.ts";

type Loader = () => Promise<{ default: Component }>;
type Guard = "auth" | "setup" | null;

interface Route {
    pattern: string;
    load: Loader;
    guard: Guard;
}

const routes: Route[] = [
    { pattern: "/", load: () => import("./pages/Dashboard.svelte"), guard: "auth" },
    { pattern: "/compose", load: () => import("./pages/Stack.svelte"), guard: "auth" },
    { pattern: "/compose/:name", load: () => import("./pages/Stack.svelte"), guard: "auth" },
    { pattern: "/compose/:name/:endpoint", load: () => import("./pages/Stack.svelte"), guard: "auth" },
    {
        pattern: "/terminal/:stack/:service/:type",
        load: () => import("./pages/ContainerTerminal.svelte"),
        guard: "auth",
    },
    {
        pattern: "/terminal/:stack/:service/:type/:endpoint",
        load: () => import("./pages/ContainerTerminal.svelte"),
        guard: "auth",
    },
    { pattern: "/console", load: () => import("./pages/Console.svelte"), guard: "auth" },
    { pattern: "/console/:endpoint", load: () => import("./pages/Console.svelte"), guard: "auth" },
    { pattern: "/settings/:section", load: () => import("./pages/Settings.svelte"), guard: "auth" },
    { pattern: "/setup", load: () => import("./pages/Setup.svelte"), guard: "setup" },
];

export interface MatchedRoute {
    path: string;
    params: Record<string, string>;
    component: Component | null;
    needsLogin: boolean;
}

const state = $state<MatchedRoute>({ path: "/", params: {}, component: null, needsLogin: false });

export const route: MatchedRoute = {
    get path() {
        return state.path;
    },
    get params() {
        return state.params;
    },
    get component() {
        return state.component;
    },
    get needsLogin() {
        return state.needsLogin;
    },
};

const beforeLeaveHooks = new Set<() => boolean | Promise<boolean>>();

/** Register a guard that may block navigation away from the current screen. Last registered wins. */
export function onBeforeLeave(hook: () => boolean | Promise<boolean>): () => void {
    beforeLeaveHooks.add(hook);
    return () => {
        beforeLeaveHooks.delete(hook);
    };
}

function matchOne(route: Route, segments: string[]): Record<string, string> | null {
    const patternSegments = route.pattern.split("/").filter((s) => s !== "");
    if (patternSegments.length !== segments.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < patternSegments.length; i += 1) {
        const p = patternSegments[i] as string;
        const s = decodeURIComponent(segments[i] as string);
        if (p.startsWith(":")) {
            params[p.slice(1)] = s;
        } else if (p !== s) {
            return null;
        }
    }
    return params;
}

function match(path: string): { route: Route; params: Record<string, string> } | null {
    const segments = path.split("/").filter((s) => s !== "");
    for (const candidate of routes) {
        const params = matchOne(candidate, segments);
        if (params !== null) return { route: candidate, params };
    }
    return null;
}

/** Move focus to the new view's heading and announce the title, so client navigation is not silent. */
function announceNavigation(): void {
    queueMicrotask(() => {
        const heading = document.querySelector<HTMLElement>("[data-audit-root] h1");
        heading?.setAttribute("tabindex", "-1");
        heading?.focus();
        const live = document.getElementById("route-announcer");
        if (live !== null) live.textContent = heading?.textContent ?? document.title;
    });
}

async function render(path: string, needsSetup: boolean): Promise<void> {
    const found = match(path);
    if (found === null) {
        state.path = path;
        state.params = {};
        state.component = null;
        state.needsLogin = false;
        return;
    }

    if (found.route.guard === "auth" && session.state !== "authenticated") {
        // Render the login gate IN PLACE; the intended path survives to after login.
        state.path = path;
        state.params = found.params;
        state.component = null;
        state.needsLogin = true;
        return;
    }
    if (found.route.guard === "setup" && !needsSetup) {
        await navigate("/", { replace: true });
        return;
    }

    const module = await found.route.load();
    state.path = path;
    state.params = found.params;
    state.component = module.default;
    state.needsLogin = false;
    announceNavigation();
}

let currentNeedsSetup = false;

/** Re-render the current path against the session's latest state, without changing history. */
export function reevaluate(needsSetup: boolean): void {
    currentNeedsSetup = needsSetup;
    void render(location.pathname, needsSetup);
}

/** Push a new history entry and render the matching route. Runs beforeLeave hooks first. */
export async function navigate(path: string, opts?: { replace?: boolean }): Promise<void> {
    for (const hook of beforeLeaveHooks) {
        const allowed = await hook();
        if (!allowed) return;
    }
    if (opts?.replace === true) {
        history.replaceState({}, "", path);
    } else {
        history.pushState({}, "", path);
    }
    await render(path, currentNeedsSetup);
}

let initialised = false;

/** Start the router: render the current path and begin handling `popstate`. Idempotent. */
export function routerInit(needsSetup: boolean): void {
    currentNeedsSetup = needsSetup;
    if (initialised) return;
    initialised = true;
    window.addEventListener("popstate", () => {
        void render(location.pathname, currentNeedsSetup);
    });
    void render(location.pathname, needsSetup);
}
