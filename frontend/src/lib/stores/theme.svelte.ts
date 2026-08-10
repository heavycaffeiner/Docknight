export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "theme";

export const theme = $state<{ preference: ThemePreference; resolved: ResolvedTheme }>({
    preference: "system",
    resolved: "light",
});

let media: MediaQueryList | null = null;

function resolve(preference: ThemePreference): ResolvedTheme {
    if (preference !== "system") return preference;
    return media?.matches === true ? "dark" : "light";
}

function apply(): void {
    theme.resolved = resolve(theme.preference);
    document.documentElement.dataset.theme = theme.resolved;

    // The meta colour follows the resolved surface so the browser chrome matches.
    const surface = getComputedStyle(document.documentElement)
        .getPropertyValue("--m3-scheme-surface")
        .trim();
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta !== null && surface !== "") meta.content = `rgb(${surface})`;
}

export function setPreference(preference: ThemePreference): void {
    theme.preference = preference;
    localStorage.setItem(STORAGE_KEY, preference);
    apply();
}

export function initTheme(): void {
    media = window.matchMedia("(prefers-color-scheme: dark)");
    const stored = localStorage.getItem(STORAGE_KEY);
    theme.preference =
        stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    apply();
    // Re-resolve while the preference is "system".
    media.addEventListener("change", () => {
        if (theme.preference === "system") apply();
    });
}
