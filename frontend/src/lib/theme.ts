import { setColorScheme } from "mdui/functions/setColorScheme.js";
import { setTheme } from "mdui/functions/setTheme.js";
import { createStore } from "./store.ts";

export type ThemePreference = "auto" | "light" | "dark";

/** Docknight's brand seed. mdui derives the whole Material 3 scheme from it. */
export const SEED_COLOR = "#1a73e8";

/**
 * Material 3 has no success or warning role, but container state needs both. Registering them
 * as custom color groups makes mdui generate tonally correct pairs that follow the theme.
 */
const CUSTOM_COLORS = [
    { name: "success", value: "#2e7d32" },
    { name: "warning", value: "#ed6c02" },
];
const THEME_COLOR_META: Record<"light" | "dark", string> = {
    light: "#1a73e8",
    dark: "#202124",
};

function storedPreference(): ThemePreference {
    if (typeof localStorage === "undefined") return "auto";
    const raw = localStorage.getItem("theme");
    return raw === "light" || raw === "dark" ? raw : "auto";
}

export const themePreference = createStore<ThemePreference>(storedPreference());

const darkQuery =
    typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");

export function resolvedTheme(): "light" | "dark" {
    const preference = themePreference.get();
    if (preference !== "auto") return preference;
    return darkQuery?.matches === true ? "dark" : "light";
}

function syncMeta(): void {
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", THEME_COLOR_META[resolvedTheme()]);
}

export function applyThemePreference(preference: ThemePreference): void {
    themePreference.set(preference);
    if (typeof localStorage !== "undefined") localStorage.setItem("theme", preference);
    setTheme(preference);
    syncMeta();
}

export function themeInit(): void {
    setColorScheme(SEED_COLOR, { customColors: CUSTOM_COLORS });
    setTheme(themePreference.get());
    syncMeta();
    darkQuery?.addEventListener("change", syncMeta);
}
