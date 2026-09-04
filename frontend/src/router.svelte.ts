import type { Component } from "svelte";
import { session } from "./lib/stores/session.svelte.ts";

export interface RouteState {
    path: string;
    params: Record<string, string>;
    component: Component | null;
}

export const route = $state<RouteState>({
    path: "/",
    params: {},
    component: null,
});

export const setup = $state({ needed: false });

interface RouteDef {
    pattern: string;
    load: () => Promise<{ default: Component }>;
    guard: "auth" | "setup" | "public";
}

const routes: RouteDef[] = [
    { pattern: "/", load: () => import("./pages/Dashboard.svelte"), guard: "auth" },
    { pattern: "/compose", load: () => import("./pages/Stack.svelte"), guard: "auth" },
    { pattern: "/compose/:name", load: () => import("./pages/Stack.svelte"), guard: "auth" },
    { pattern: "/compose/:name/:endpoint", load: () => import("./pages/Stack.svelte"), guard: "auth" },
    { pattern: "/terminal/:stack/:service/:type", load: () => import("./pages/ContainerTerminal.svelte"), guard: "auth" },
    { pattern: "/terminal/:stack/:service/:type/:endpoint", load: () => import("./pages/ContainerTerminal.svelte"), guard: "auth" },
    { pattern: "/console", load: () => import("./pages/Console.svelte"), guard: "auth" },
    { pattern: "/console/:endpoint", load: () => import("./pages/Console.svelte"), guard: "auth" },
    { pattern: "/settings/:section", load: () => import("./pages/Settings.svelte"), guard: "auth" },
    { pattern: "/setup", load: () => import("./pages/Setup.svelte"), guard: "setup" },
];

const beforeLeaveHooks = new Set<() => Promise<boolean> | boolean>();

export function registerBeforeLeave(hook: () => Promise<boolean> | boolean): () => void {
    beforeLeaveHooks.add(hook);
    return () => beforeLeaveHooks.delete(hook);
}

function matchRoute(path: string): { route: RouteDef; params: Record<string, string> } | null {
    const pathSegs = path.split("/").filter(Boolean);

    for (const r of routes) {
        const routeSegs = r.pattern.split("/").filter(Boolean);
        if (routeSegs.length !== pathSegs.length) continue;

        let matched = true;
        const params: Record<string, string> = {};

        for (let i = 0; i < routeSegs.length; i++) {
            const rSeg = routeSegs[i];
            const pSeg = pathSegs[i];
            if (rSeg === undefined || pSeg === undefined) {
                matched = false;
                break;
            }

            if (rSeg.startsWith(":")) {
                params[rSeg.slice(1)] = decodeURIComponent(pSeg);
            } else if (rSeg !== pSeg) {
                matched = false;
                break;
            }
        }

        if (matched) {
            return { route: r, params };
        }
    }

    return null;
}

export async function navigate(path: string, options: { replace?: boolean } = {}): Promise<void> {
    for (const hook of beforeLeaveHooks) {
        const canLeave = await hook();
        if (!canLeave) return;
    }

    if (typeof history !== "undefined") {
        if (options.replace) {
            history.replaceState({}, "", path);
        } else {
            history.pushState({}, "", path);
        }
    }

    await render(path);
}

export async function reevaluate(): Promise<void> {
    if (typeof location !== "undefined") {
        await render(location.pathname);
    }
}

export async function render(path: string): Promise<void> {
    const matched = matchRoute(path);

    if (matched === null) {
        const home = routes[0];
        if (home !== undefined) {
            const mod = await home.load();
            route.path = "/";
            route.params = {};
            route.component = mod.default;
        }
        return;
    }

    const { route: targetRoute, params } = matched;

    if (targetRoute.guard === "auth" && session.state !== "authenticated") {
        const loginMod = await import("./pages/Login.svelte");
        route.path = path;
        route.params = params;
        route.component = loginMod.default;
        return;
    }

    if (targetRoute.guard === "setup" && !setup.needed) {
        await navigate("/", { replace: true });
        return;
    }

    const mod = await targetRoute.load();
    route.path = path;
    route.params = params;
    route.component = mod.default;
}

export function routerInit(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("popstate", () => {
        void render(location.pathname);
    });
}
