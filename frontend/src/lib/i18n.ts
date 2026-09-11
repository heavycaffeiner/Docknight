import { loadLocale } from "mdui/functions/loadLocale.js";
import { setLocale as setMduiLocale } from "mdui/functions/setLocale.js";
import { useMemo } from "react";
import en from "../locales/en.json";
import ko from "../locales/ko.json";
import { createStore, useStore } from "./store.ts";

/** The two languages Docknight ships. Adding one means adding a catalogue and a row here. */
export const LOCALES: Record<string, string> = {
    en: "English",
    ko: "한국어",
};

export type LocaleTag = keyof typeof LOCALES;

/** mdui ships its own component strings under BCP 47 codes that differ from ours. */
const MDUI_LOCALE_BY_TAG: Record<string, Parameters<typeof setMduiLocale>[0]> = {
    ko: "ko-kr",
};

const messages: Record<string, Record<string, string>> = { en, ko };

function storedLocale(): string {
    if (typeof localStorage === "undefined") return "en";
    const stored = localStorage.getItem("locale") ?? "";
    return stored in LOCALES ? stored : "en";
}

export const locale = createStore<string>(storedLocale());

/**
 * mdui resolves its own component strings through lit-localize, which throws on `setLocale`
 * unless a loader is registered first. Korean is the only pack the app can ask for.
 */
loadLocale((tag) =>
    tag === "ko-kr"
        ? import("mdui/locales/ko-kr.js")
        : Promise.reject(new Error(`no mdui locale ${tag}`)),
);

if (typeof document !== "undefined") {
    document.documentElement.lang = locale.get();
}

export async function setLocale(tag: string): Promise<void> {
    if (!(tag in LOCALES)) return;

    // A failed component-locale load must not block the app's own strings from switching.
    const mduiTag = MDUI_LOCALE_BY_TAG[tag];
    if (mduiTag !== undefined) {
        try {
            await setMduiLocale(mduiTag);
        } catch (error) {
            console.error("mdui locale failed to load", error);
        }
    }

    if (typeof localStorage !== "undefined") localStorage.setItem("locale", tag);
    if (typeof document !== "undefined") document.documentElement.lang = tag;
    locale.set(tag);
}

export async function i18nInit(): Promise<void> {
    const tag = locale.get();
    if (tag !== "en") await setLocale(tag);
}

function interpolate(raw: string, values: Record<string, string | number> | undefined): string {
    if (values === undefined) return raw;
    return raw.replace(/\{(\w+)\}/g, (match, key: string) => {
        const value = values[key];
        return value !== undefined ? String(value) : match;
    });
}

/** Module-scoped translate, for code that runs outside a component. */
export function t(key: string, values?: Record<string, string | number>): string {
    const tag = locale.get();
    return interpolate(messages[tag]?.[key] ?? messages.en?.[key] ?? key, values);
}

export function tc(key: string, count: number, values?: Record<string, string | number>): string {
    const tag = locale.get();
    const category = new Intl.PluralRules(tag).select(count);
    const raw =
        messages[tag]?.[`${key}.${category}`] ??
        messages[tag]?.[`${key}.other`] ??
        messages.en?.[`${key}.other`] ??
        key;
    return interpolate(raw, { count, ...values });
}

export interface Translate {
    t: typeof t;
    tc: typeof tc;
    locale: string;
}

/** Subscribing hook: a component using this re-renders when the locale changes. */
export function useT(): Translate {
    const tag = useStore(locale);
    return useMemo(() => ({ t, tc, locale: tag }), [tag]);
}
