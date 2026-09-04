export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const initialPreference =
    (typeof localStorage !== "undefined" && (localStorage.getItem("theme") as ThemePreference)) || "system";

let preference = $state<ThemePreference>(initialPreference);
const mq = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let systemIsDark = $state(mq?.matches ?? false);

if (mq !== null) {
    mq.addEventListener("change", (e) => {
        systemIsDark = e.matches;
    });
}

export const theme = {
    get preference(): ThemePreference {
        return preference;
    },
    set preference(val: ThemePreference) {
        preference = val;
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("theme", val);
        }
    },
    get resolved(): ResolvedTheme {
        if (preference === "system") {
            return systemIsDark ? "dark" : "light";
        }
        return preference;
    },
};

export function themeInit(): void {
    $effect.root(() => {
        $effect(() => {
            const resolved = theme.resolved;
            if (typeof document !== "undefined") {
                document.documentElement.dataset.theme = resolved;
                const meta = document.querySelector('meta[name="theme-color"]');
                if (meta !== null) {
                    meta.setAttribute("content", resolved === "dark" ? "#202124" : "#1a73e8");
                }
            }
        });
    });
}
