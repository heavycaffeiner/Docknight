export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

function readStoredPreference(): ThemePreference {
    const stored = localStorage.getItem("theme");
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

// systemDark is tracked as its own reactive field, not read directly from mediaQuery.matches
// inside the $derived below: a plain DOM property read is invisible to Svelte's dependency
// tracking, so the derived value would never know to re-run when the OS preference changes.
const state = $state<{ preference: ThemePreference; systemDark: boolean }>({
    preference: readStoredPreference(),
    systemDark: mediaQuery.matches,
});

const resolved = $derived<ResolvedTheme>(
    state.preference === "system" ? (state.systemDark ? "dark" : "light") : state.preference,
);

export const theme: { preference: ThemePreference; readonly resolved: ResolvedTheme } = {
    get preference() {
        return state.preference;
    },
    set preference(value: ThemePreference) {
        state.preference = value;
        localStorage.setItem("theme", value);
    },
    get resolved() {
        return resolved;
    },
};

function applyTheme(): void {
    document.documentElement.dataset.theme = theme.resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta !== null) {
        const surface = getComputedStyle(document.documentElement).getPropertyValue("--m3c-surface").trim();
        if (surface !== "") meta.setAttribute("content", surface);
    }
}

$effect.root(() => {
    $effect(() => {
        applyTheme();
    });
});

mediaQuery.addEventListener("change", (event) => {
    state.systemDark = event.matches;
});
