import en from "../../locales/en.json";

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

const catalogues = import.meta.glob<{ default: Record<string, string> }>("../../locales/*.json");

const initialLocale = (typeof localStorage !== "undefined" && localStorage.getItem("locale")) || "en";
let currentLocale = $state<string>(initialLocale);
const messages = $state<Record<string, Record<string, string>>>({ en });

if (typeof document !== "undefined") {
    document.documentElement.lang = initialLocale;
    const base = initialLocale.split("-")[0] ?? "";
    document.documentElement.dir = RTL_LANGUAGES.has(base) ? "rtl" : "ltr";
}

if (initialLocale !== "en") {
    void setLocale(initialLocale);
}
export const i18n = {
    get locale(): string {
        return currentLocale;
    },
};

export async function setLocale(tag: string): Promise<void> {
    if (messages[tag] === undefined) {
        const path = `../../locales/${tag}.json`;
        const loader = catalogues[path];
        if (loader !== undefined) {
            const mod = await loader();
            messages[tag] = mod.default;
        }
    }
    currentLocale = tag;
    if (typeof localStorage !== "undefined") {
        localStorage.setItem("locale", tag);
    }
    if (typeof document !== "undefined") {
        document.documentElement.lang = tag;
        const base = tag.split("-")[0] ?? "";
        document.documentElement.dir = RTL_LANGUAGES.has(base) ? "rtl" : "ltr";
    }
}

export async function i18nInit(): Promise<void> {
    if (initialLocale !== "en") {
        await setLocale(initialLocale);
    }
}

export function t(key: string, values?: Record<string, string | number>): string {
    const raw = messages[currentLocale]?.[key] ?? messages.en?.[key] ?? key;
    if (values === undefined) return raw;
    return raw.replace(/\{(\w+)\}/g, (match, k: string) => {
        const val = values[k];
        return val !== undefined ? String(val) : match;
    });
}

export function tc(key: string, count: number, values?: Record<string, string | number>): string {
    const pr = new Intl.PluralRules(currentLocale);
    const category = pr.select(count);
    const raw =
        messages[currentLocale]?.[`${key}.${category}`] ??
        messages[currentLocale]?.[`${key}.other`] ??
        messages.en?.[`${key}.other`] ??
        key;

    return raw.replace(/\{(\w+)\}/g, (match, k: string) => {
        if (k === "count") return String(count);
        const val = values?.[k];
        return val !== undefined ? String(val) : match;
    });
}

export async function getAvailableLocales(): Promise<Array<{ tag: string; name: string }>> {
    const list: Array<{ tag: string; name: string }> = [];
    for (const [path, loader] of Object.entries(catalogues)) {
        const match = /\/([^/]+)\.json$/.exec(path);
        if (match !== null && match[1] !== undefined) {
            const tag = match[1];
            const mod = await loader();
            list.push({ tag, name: mod.default.languageName || tag });
        }
    }
    return list;
}
