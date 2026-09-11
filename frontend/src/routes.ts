import { type ComponentType, lazy, useMemo } from "react";
import { matchPattern, useRoute } from "./lib/router.ts";

interface RouteDef {
    pattern: string;
    Component: ComponentType;
}

/**
 * Authenticated routes only. The login and setup screens are rendered by `App` ahead of the
 * table, because they are states of the session rather than destinations.
 *
 * Containers, images, volumes, and networks are tabs of one Resources screen rather than four
 * destinations: a bottom navigation bar holds five items at most, and those four are one task.
 */
const routes: RouteDef[] = [
    { pattern: "/", Component: lazy(() => import("./pages/Dashboard.tsx")) },
    { pattern: "/compose", Component: lazy(() => import("./pages/Stack.tsx")) },
    { pattern: "/compose/:name", Component: lazy(() => import("./pages/Stack.tsx")) },
    { pattern: "/compose/:name/:endpoint", Component: lazy(() => import("./pages/Stack.tsx")) },
    { pattern: "/resources", Component: lazy(() => import("./pages/Resources.tsx")) },
    { pattern: "/resources/:kind", Component: lazy(() => import("./pages/Resources.tsx")) },
    {
        pattern: "/resources/:kind/:endpoint",
        Component: lazy(() => import("./pages/Resources.tsx")),
    },
    {
        pattern: "/terminal/:stack/:service/:type",
        Component: lazy(() => import("./pages/ContainerTerminal.tsx")),
    },
    {
        pattern: "/terminal/:stack/:service/:type/:endpoint",
        Component: lazy(() => import("./pages/ContainerTerminal.tsx")),
    },
    { pattern: "/console", Component: lazy(() => import("./pages/Console.tsx")) },
    { pattern: "/console/:endpoint", Component: lazy(() => import("./pages/Console.tsx")) },
    { pattern: "/settings", Component: lazy(() => import("./pages/Settings.tsx")) },
    { pattern: "/settings/:section", Component: lazy(() => import("./pages/Settings.tsx")) },
];

export interface ResolvedRoute {
    Component: ComponentType;
    params: Record<string, string>;
}

export function resolveRoute(path: string): ResolvedRoute {
    for (const def of routes) {
        const params = matchPattern(def.pattern, path);
        if (params !== null) return { Component: def.Component, params };
    }
    const home = routes[0];
    if (home === undefined) throw new Error("route table is empty");
    return { Component: home.Component, params: {} };
}

/** Path parameters for the currently rendered route. */
export function useParams(): Record<string, string> {
    const { path } = useRoute();
    return useMemo(() => resolveRoute(path).params, [path]);
}
