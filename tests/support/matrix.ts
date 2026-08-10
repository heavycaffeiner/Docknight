import { SCENARIOS, type Scenario, type ScenarioName } from "../../tools/fixtures/data/scenarios.ts";

export type Theme = "light" | "dark";

/** Widths in CSS pixels. 320 exists for the WCAG reflow requirement and asserts overflow only. */
export const WIDTHS = [320, 360, 600, 840, 1280, 1920] as const;

/** The two widths every non-default axis is sampled at, one narrow and one wide. */
export const DETAIL_WIDTHS = [360, 1280] as const;

export const THEMES: readonly Theme[] = ["light", "dark"];

export const REFLOW_WIDTH = 320;

/** The rules asserted at the reflow width, where every other rule is out of scope. */
export const REFLOW_RULES = ["overflow"];

export const DEFAULT_LOCALE = "en";
export const PSEUDO_LOCALE = "en-XA";
export const RTL_LOCALE = "ar-XB";

/** Scenarios that need a fixture backend of their own, and the port each one listens on. */
export const SCENARIO_PORTS: Record<string, number> = {
    typical: 5101,
    empty: 5102,
    dense: 5103,
    extreme: 5104,
    degraded: 5105,
};

/** Scenarios sampled beyond `typical`, at the two detail widths. */
const EXTRA_SCENARIOS: ScenarioName[] = ["extreme", "dense", "empty", "degraded"];

export function originFor(scenario: ScenarioName): string {
    const port = SCENARIO_PORTS[scenario];
    if (port === undefined) throw new Error(`no fixture port for scenario ${scenario}`);
    return `http://127.0.0.1:${port}`;
}

const built = new Map<ScenarioName, Scenario>();

function dataFor(scenario: ScenarioName): Scenario {
    const existing = built.get(scenario);
    if (existing !== undefined) return existing;
    const fresh = SCENARIOS[scenario]();
    built.set(scenario, fresh);
    return fresh;
}

/** The stack a screen addresses, chosen by name so the same cell is the same page every run. */
function target(scenario: ScenarioName): { stack: string; service: string } | null {
    const data = dataFor(scenario);
    const stack = Object.keys(data.stacks).sort()[0];
    if (stack === undefined) return null;
    const service = Object.keys(data.serviceStatus[stack] ?? {}).sort()[0] ?? "app";
    return { stack, service };
}

export interface ScreenDefinition {
    key: string;
    /** Null when the scenario holds no data this screen can render. */
    path: (scenario: ScenarioName) => string | null;
    /** Sign-in screens are reached by withholding the fixture token. */
    anonymous?: boolean;
}

export const SCREENS: ScreenDefinition[] = [
    { key: "login", path: () => "/", anonymous: true },
    { key: "dashboard", path: () => "/" },
    { key: "stack-new", path: () => "/compose" },
    {
        key: "stack",
        path: (scenario) => {
            const found = target(scenario);
            return found === null ? null : `/compose/${encodeURIComponent(found.stack)}`;
        },
    },
    {
        key: "terminal",
        path: (scenario) => {
            const found = target(scenario);
            if (found === null) return null;
            return `/terminal/${encodeURIComponent(found.stack)}/${encodeURIComponent(found.service)}/sh`;
        },
    },
    { key: "console", path: () => "/console" },
    { key: "settings-general", path: () => "/settings/general" },
    { key: "settings-updates", path: () => "/settings/updates" },
    { key: "settings-appearance", path: () => "/settings/appearance" },
    { key: "settings-security", path: () => "/settings/security" },
    { key: "settings-globalenv", path: () => "/settings/globalenv" },
    { key: "settings-about", path: () => "/settings/about" },
];

export interface Cell {
    /** Stable identifier, also the report key and the screenshot stem. */
    id: string;
    screen: string;
    path: string;
    scenario: ScenarioName;
    width: number;
    theme: Theme;
    locale: string;
    anonymous: boolean;
    /** When set, only these rules run. The reflow width is the only cell that sets it. */
    only: string[] | null;
}

function cell(
    screen: ScreenDefinition,
    scenario: ScenarioName,
    width: number,
    theme: Theme,
    locale: string,
): Cell | null {
    const path = screen.path(scenario);
    if (path === null) return null;
    const parts = [screen.key, theme, String(width)];
    if (locale !== DEFAULT_LOCALE) parts.push(locale);
    if (scenario !== "typical") parts.push(scenario);
    return {
        id: parts.join("."),
        screen: screen.key,
        path,
        scenario,
        width,
        theme,
        locale,
        anonymous: screen.anonymous === true,
        only: width === REFLOW_WIDTH ? REFLOW_RULES : null,
    };
}

/**
 * The layout matrix: every screen at every width in English, both themes; every screen at the two
 * detail widths in the pseudo-locale and the right-to-left locale; and the four extra scenarios at
 * the same two widths. A full cross product would be several thousand cells for no extra coverage.
 */
export function layoutMatrix(): Cell[] {
    const cells: Cell[] = [];
    for (const screen of SCREENS) {
        for (const width of WIDTHS) {
            for (const theme of THEMES) {
                const made = cell(screen, "typical", width, theme, DEFAULT_LOCALE);
                if (made !== null) cells.push(made);
            }
        }
        for (const width of DETAIL_WIDTHS) {
            for (const locale of [PSEUDO_LOCALE, RTL_LOCALE]) {
                const made = cell(screen, "typical", width, "light", locale);
                if (made !== null) cells.push(made);
            }
            for (const scenario of EXTRA_SCENARIOS) {
                const made = cell(screen, scenario, width, "light", DEFAULT_LOCALE);
                if (made !== null) cells.push(made);
            }
        }
    }
    return cells;
}

/** The accessibility scan runs on every layout cell, including the reflow width. */
export function accessibilityMatrix(): Cell[] {
    return layoutMatrix();
}
