import en from "../../locales/en.json";

type Catalogue = Record<string, string>;

/** Adding a file adds a language; there is no second list to keep in step. */
const available = import.meta.glob<{ default: Catalogue }>("../../locales/*.json");

const RTL = new Set(["ar", "he", "fa", "ur", "yi", "dv", "ps", "ckb"]);

/** Generated catalogues. Present in development and in a verification build, absent from a release. */
const PSEUDO = new Set(["en-XA", "ar-XB"]);

const includePseudo = import.meta.env.DEV || import.meta.env.VITE_PSEUDO_LOCALES === "1";

const STORAGE_KEY = "locale";

function tagOf(path: string): string {
    return path.replace(/^.*\//, "").replace(/\.json$/, "");
}

export const locales: string[] = Object.keys(available)
    .map(tagOf)
    .filter((tag) => includePseudo || !PSEUDO.has(tag))
    .sort((a, b) => a.localeCompare(b));

const messages = $state<Record<string, Catalogue>>({ en: en as Catalogue });

function baseLanguage(tag: string): string {
    return tag.split("-")[0] ?? tag;
}

function negotiate(preferred: readonly string[]): string {
    for (const candidate of preferred) {
        if (locales.includes(candidate)) return candidate;
        const base = baseLanguage(candidate);
        const match = locales.find((tag) => baseLanguage(tag) === base);
        if (match !== undefined) return match;
    }
    return "en";
}

function initialLocale(): string {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && locales.includes(stored)) return stored;
    return negotiate(navigator.languages ?? [navigator.language]);
}

export const i18n = $state<{ locale: string; dir: "ltr" | "rtl" }>({
    locale: "en",
    dir: "ltr",
});

const missing = new Set<string>();

function interpolate(template: string, values?: Record<string, string | number>): string {
    if (values === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
        const value = values[key];
        return value === undefined ? whole : String(value);
    });
}

function lookup(key: string): string | undefined {
    return messages[i18n.locale]?.[key] ?? (messages.en as Catalogue)[key];
}

/** Translate a key, interpolating {name} placeholders. Nothing ever renders blank. */
export function t(key: string, values?: Record<string, string | number>): string {
    const template = lookup(key);
    if (template === undefined) {
        if (import.meta.env.DEV && !missing.has(key)) {
            missing.add(key);
            console.warn(`i18n: no message for ${key}`);
        }
        return key;
    }
    return interpolate(template, values);
}

/** Translate with plural selection driven by Intl.PluralRules for the active locale. */
export function tc(key: string, count: number, values?: Record<string, string | number>): string {
    const category = new Intl.PluralRules(i18n.locale).select(count);
    const template =
        messages[i18n.locale]?.[`${key}.${category}`] ??
        messages[i18n.locale]?.[`${key}.other`] ??
        (messages.en as Catalogue)[`${key}.${category}`] ??
        (messages.en as Catalogue)[`${key}.other`] ??
        key;
    return interpolate(template, { ...values, count });
}

/** The language's own name, for the selector. */
export function languageName(tag: string): string {
    return messages[tag]?.languageName ?? tag;
}

function applyDocument(tag: string): void {
    i18n.dir = RTL.has(baseLanguage(tag)) ? "rtl" : "ltr";
    document.documentElement.lang = tag;
    document.documentElement.dir = i18n.dir;
}

/** Switch locale, lazily importing its catalogue and updating document lang and dir. */
export async function setLocale(tag: string): Promise<void> {
    if (!locales.includes(tag)) throw new Error(`unknown locale ${tag}`);
    if (messages[tag] === undefined) {
        const loader = available[`../../locales/${tag}.json`];
        if (loader === undefined) throw new Error(`no catalogue for ${tag}`);
        const module = await loader();
        messages[tag] = module.default;
    }
    i18n.locale = tag;
    localStorage.setItem(STORAGE_KEY, tag);
    applyDocument(tag);
}

/** Load the negotiated locale at boot. English is bundled, so this never blocks first paint. */
export async function initLocale(): Promise<void> {
    const tag = initialLocale();
    if (tag === "en") {
        i18n.locale = "en";
        applyDocument("en");
        return;
    }
    try {
        await setLocale(tag);
    } catch {
        i18n.locale = "en";
        applyDocument("en");
    }
}

/** Preload every catalogue so the selector can show each language's own name. */
export async function loadLanguageNames(): Promise<void> {
    await Promise.all(
        locales.map(async (tag) => {
            if (messages[tag] !== undefined) return;
            const loader = available[`../../locales/${tag}.json`];
            if (loader === undefined) return;
            try {
                messages[tag] = (await loader()).default;
            } catch {
                // A catalogue that fails to load simply keeps its tag in the selector.
            }
        }),
    );
}
