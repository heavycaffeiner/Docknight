import { QueryClient } from "@tanstack/react-query";
import { on } from "./transport.ts";

/**
 * One client for the whole app. Retries are off because the transport already queues a request
 * until the socket is back, and refetch-on-focus is off because the server pushes list state.
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
            staleTime: 5_000,
            refetchOnWindowFocus: false,
        },
        mutations: {
            retry: false,
        },
    },
});

/** Query keys. The endpoint is always the first segment so one host can be invalidated alone. */
export const qk = {
    stack: (endpoint: string, name: string) => [endpoint, "stack", name] as const,
    serviceStatus: (endpoint: string, name: string) => [endpoint, "serviceStatus", name] as const,
    dockerStats: (endpoint: string) => [endpoint, "docker", "stats"] as const,
    networks: (endpoint: string) => [endpoint, "docker", "networks"] as const,
    images: (endpoint: string) => [endpoint, "docker", "images"] as const,
    volumes: (endpoint: string) => [endpoint, "docker", "volumes"] as const,
    containers: (endpoint: string) => [endpoint, "docker", "containers"] as const,
    settings: () => ["", "settings"] as const,
    consoleEnabled: () => ["", "terminal", "mainEnabled"] as const,
    upgradeStatus: () => ["", "upgrade", "status"] as const,
};

/**
 * A stack lifecycle command changes containers, images in use, and networks, so a push of the
 * new stack list is the signal to refetch every per-host docker resource query.
 */
export function queryInvalidationInit(): void {
    on("stackList", (_payload: unknown, endpoint: string) => {
        void queryClient.invalidateQueries({ queryKey: [endpoint, "docker"] });
    });
}
