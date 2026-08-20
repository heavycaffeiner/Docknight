import type { ScenarioName } from "../../tools/fixtures/data/index.ts";

/** Viewport geometry. Height is what a keyboard takes and what landscape has none of. */
export interface Geometry {
    id: string;
    width: number;
    height: number;
    touch: boolean;
}

export const GEOMETRIES: readonly Geometry[] = [
    { id: "reflow", width: 320, height: 900, touch: false },
    { id: "phone", width: 390, height: 844, touch: true },
    { id: "phone-wide", width: 600, height: 900, touch: true },
    { id: "phone-land", width: 780, height: 390, touch: true },
    { id: "keyboard", width: 390, height: 380, touch: true },
    { id: "tablet", width: 840, height: 1120, touch: true },
    { id: "laptop", width: 1280, height: 900, touch: false },
    { id: "desktop", width: 1920, height: 1080, touch: false },
];

export type ScreenName =
    | "login"
    | "setup"
    | "dashboard"
    | "stack"
    | "stack-edit"
    | "settings-general"
    | "settings-security";

/** Path each screen resolves to, in the fixture-served app; login and setup pre-empt auth. */
export const SCREEN_PATHS: Record<ScreenName, string> = {
    login: "/",
    setup: "/",
    dashboard: "/",
    stack: "/compose/immich",
    "stack-edit": "/compose/immich",
    "settings-general": "/settings/general",
    "settings-security": "/settings/security",
};

/** Screens that carry a text field, per proposal 8: the only ones sampled at keyboard/phone-land. */
const TEXT_FIELD_SCREENS = new Set<ScreenName>(["login", "setup", "stack", "settings-general"]);

export interface Cell {
    id: string;
    screen: ScreenName;
    geometry: Geometry;
    theme: "light" | "dark";
    locale: string;
    scenario: ScenarioName;
    /** Restricts which auditor rules apply; only "reflow" cells set this, to overflow rules. */
    rules?: string[];
}

const REFLOW_RULES = ["overflow"];
const SCREENS: ScreenName[] = [
    "login",
    "setup",
    "dashboard",
    "stack",
    "stack-edit",
    "settings-general",
    "settings-security",
];
const STRESS_SCENARIOS: ScenarioName[] = ["extreme", "dense", "empty", "degraded"];
const STRESS_GEOMETRIES = ["phone", "laptop"];
// The pseudo-locale en-XA is generated at build time by phase 10's generator and is
// deliberately absent until then; ar alone still exercises the RTL direction rules.
const LOCALE_STRESS_LOCALES = ["ar"];

function makeCell(
    screen: ScreenName,
    geometry: Geometry,
    theme: "light" | "dark",
    locale: string,
    scenario: ScenarioName,
    rules?: string[],
): Cell {
    // The base id stays short for the common case; a locale or scenario stress cell appends
    // whichever axis it varies, since two cells can otherwise share a screen/theme/geometry
    // triple (the same phone-laptop pair is reused across every stress scenario).
    const localeSuffix = locale === "en" ? "" : `.${locale}`;
    const scenarioSuffix = scenario === "typical" ? "" : `.${scenario}`;
    return {
        id: `${screen}.${theme}.${geometry.id}${localeSuffix}${scenarioSuffix}`,
        screen,
        geometry,
        theme,
        locale,
        scenario,
        ...(rules === undefined ? {} : { rules }),
    };
}

/**
 * The sampled matrix per proposal 8 section 4.3.3: every screen at every geometry in en, light
 * and dark; every screen at phone and laptop in the pseudo-locale and the RTL locale; the four
 * stress scenarios at phone and laptop. `keyboard` and `phone-land` are sampled only against
 * screens carrying a text field. `reflow` runs only the overflow rules.
 */
export function cells(): Cell[] {
    const result: Cell[] = [];

    for (const screen of SCREENS) {
        for (const geometry of GEOMETRIES) {
            if ((geometry.id === "keyboard" || geometry.id === "phone-land") && !TEXT_FIELD_SCREENS.has(screen)) {
                continue;
            }
            const rules = geometry.id === "reflow" ? REFLOW_RULES : undefined;
            result.push(makeCell(screen, geometry, "light", "en", "typical", rules));
            if (geometry.id !== "reflow") {
                result.push(makeCell(screen, geometry, "dark", "en", "typical", rules));
            }
        }
    }

    const stressGeometries = GEOMETRIES.filter((g) => STRESS_GEOMETRIES.includes(g.id));
    for (const screen of SCREENS) {
        for (const geometry of stressGeometries) {
            for (const locale of LOCALE_STRESS_LOCALES) {
                result.push(makeCell(screen, geometry, "light", locale, "typical"));
            }
        }
    }

    for (const scenario of STRESS_SCENARIOS) {
        for (const geometry of stressGeometries) {
            result.push(makeCell("dashboard", geometry, "light", "en", scenario));
            result.push(makeCell("stack", geometry, "light", "en", scenario));
        }
    }

    return result;
}
