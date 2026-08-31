import en from "../../locales/en.json";

type Messages = Record<string, string>;

/** file list = language list; each catalogue names itself via its own "languageName" key. */
const catalogueLoaders = import.meta.glob<{ default: Messages }>("../../locales/*.json");

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

function baseLanguage(tag: string): string {
    return tag.split("-")[0] ?? tag;
}

function availableLocales(): string[] {
    return Object.keys(catalogueLoaders)
        .map((path) => path.replace("../../locales/", "").replace(".json", ""))
        .sort((a, b) => a.localeCompare(b));
}

function negotiate(preferred: readonly string[], available: readonly string[]): string {
    for (const tag of preferred) {
        if (available.includes(tag)) return tag;
        const base = baseLanguage(tag);
        const match = available.find((a) => baseLanguage(a) === base);
        if (match !== undefined) return match;
    }
    return "en";
}

function initialLocale(): string {
    const stored = localStorage.getItem("locale");
    if (stored !== null) return stored;
    return negotiate(navigator.languages, availableLocales());
}

const state = $state<{ locale: string; messages: Record<string, Messages> }>({
    locale: initialLocale(),
    messages: { en: en as Messages },
});

const warnedKeys = new Set<string>();

function interpolate(template: string, values?: Record<string, string | number>): string {
    if (values === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = values[name];
        return value === undefined ? match : String(value);
    });
}

/** Translate a key, interpolating {name} placeholders from `values`. */
export function t(key: string, values?: Record<string, string | number>): string {
    const template = state.messages[state.locale]?.[key] ?? state.messages.en?.[key];
    if (template === undefined) {
        if (!warnedKeys.has(key) && import.meta.env.DEV) {
            warnedKeys.add(key);
            console.warn(`docknight i18n: missing key "${key}"`);
        }
        return key;
    }
    return interpolate(template, values);
}

/** True when `key` resolves in the active locale or the English fallback. */
export function hasMessage(key: string): boolean {
    return (state.messages[state.locale]?.[key] ?? state.messages.en?.[key]) !== undefined;
}

/** Translate with plural selection driven by Intl.PluralRules for the active locale. */
export function tc(key: string, count: number, values?: Record<string, string | number>): string {
    const rules = new Intl.PluralRules(state.locale);
    const category = rules.select(count);
    const table = state.messages[state.locale] ?? state.messages.en ?? {};
    const enTable = state.messages.en ?? {};
    const template = table[`${key}.${category}`] ?? table[`${key}.other`] ?? enTable[`${key}.other`] ?? key;
    return interpolate(template, { ...values, count });
}

/** Switch locale, lazily importing its catalogue and updating document lang and dir. */
export async function setLocale(tag: string): Promise<void> {
    if (state.messages[tag] === undefined) {
        const path = `../../locales/${tag}.json`;
        const loader = catalogueLoaders[path];
        if (loader === undefined) return;
        const mod = await loader();
        state.messages = { ...state.messages, [tag]: mod.default };
    }
    state.locale = tag;
    localStorage.setItem("locale", tag);
    document.documentElement.lang = tag;
    document.documentElement.dir = RTL_LANGUAGES.has(baseLanguage(tag)) ? "rtl" : "ltr";
}

export function listLocales(): { tag: string; name: string }[] {
    // The pseudo-locale is a development tool, generated at build time from en.json and never
    // meant for an end user to pick; the production selector filters any tag it would produce.
    const visible = availableLocales().filter(
        (tag) => import.meta.env.DEV || !tag.startsWith("en-X"),
    );
    return visible.map((tag) => ({
        tag,
        name: (state.messages[tag] ?? {}).languageName ?? tag,
    }));
}

export const i18n: { readonly locale: string } = {
    get locale() {
        return state.locale;
    },
};

// Applies the initial locale's direction and lang attribute; the catalogue for a non-English
// initial locale loads lazily via setLocale, matching every later switch.
void setLocale(state.locale);
