/**
 * Reactive `matchMedia`. The window size class decides disclosure as well as sizes, so several
 * components branch on it in markup rather than in CSS, and a value read once at component init is
 * wrong for the rest of the session. One listener per distinct query, shared by every caller.
 */

/** Material's compact window size class, which is where disclosure changes. */
export const COMPACT = "(width < 600px)";

/** Material's expanded class, where the list and the detail sit side by side. */
export const EXPANDED = "(width >= 840px)";

export interface Match {
    readonly value: boolean;
}

const tracked = new Map<string, Match>();

function track(query: string): Match {
    const list = window.matchMedia(query);
    const state = $state({ matches: list.matches });
    list.addEventListener("change", (event) => (state.matches = event.matches));
    return {
        get value(): boolean {
            return state.matches;
        },
    };
}

export function media(query: string): Match {
    const held = tracked.get(query);
    if (held !== undefined) return held;
    const made = track(query);
    tracked.set(query, made);
    return made;
}
