import { useSyncExternalStore } from "react";

/** mdui's breakpoint tokens, mirrored so JS and CSS agree on where the layout changes. */
export const BREAKPOINT = { sm: 600, md: 840, lg: 1080, xl: 1440 } as const;

const queries = new Map<string, MediaQueryList>();

function listFor(query: string): MediaQueryList {
    let list = queries.get(query);
    if (list === undefined) {
        list = window.matchMedia(query);
        queries.set(query, list);
    }
    return list;
}

export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (listener) => {
            const list = listFor(query);
            list.addEventListener("change", listener);
            return () => list.removeEventListener("change", listener);
        },
        () => listFor(query).matches,
        () => false,
    );
}

export type SizeClass = "compact" | "medium" | "expanded";

/**
 * Material 3 window size classes. Width selects the layout; it never selects control density,
 * which follows the pointer.
 */
export function useSizeClass(): SizeClass {
    const atLeastMedium = useMediaQuery(`(min-width: ${BREAKPOINT.sm}px)`);
    const atLeastExpanded = useMediaQuery(`(min-width: ${BREAKPOINT.md}px)`);
    if (atLeastExpanded) return "expanded";
    return atLeastMedium ? "medium" : "compact";
}
