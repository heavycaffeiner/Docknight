import { SCENARIOS, type Scenario, type ScenarioName } from "../../tools/fixtures/data/scenarios.ts";

export type Theme = "light" | "dark";

/** Viewport geometry, not just width. Height is what a keyboard takes and what landscape has none of. */
export interface Geometry {
    id: string;
    width: number;
    height: number;
    touch: boolean;
}

/**
 * The device space the layout is sampled over. Three of the numbers are not the obvious ones.
 *
 * `phone-land` is 780 wide rather than 844, because 844 is past the 840 breakpoint and would render
 * the expanded layout with its pinned panel, which is not what WCAG 1.3.4 asks about. Its height is
 * a multiple of the grid step, so the shell's own box is not a violation of the cell it exists to
 * exercise. `keyboard` models a keyboard-open phone as the short viewport that
 * `interactive-widget=resizes-content` actually produces. `reflow` keeps 900, because it runs the
 * overflow rule alone and 1.4.10 is a statement about width.
 */
export const GEOMETRIES: readonly Geometry[] = [
    { id: "reflow", width: 320, height: 900, touch: false },
    { id: "phone", width: 390, height: 844, touch: true },
    { id: "phone-wide", width: 600, height: 900, touch: true },
    { id: "phone-land", width: 780, height: 392, touch: true },
    { id: "keyboard", width: 390, height: 380, touch: true },
    { id: "tablet", width: 840, height: 1120, touch: true },
    { id: "laptop", width: 1280, height: 900, touch: false },
    { id: "desktop", width: 1920, height: 1080, touch: false },
];

function geometry(id: string): Geometry {
    const found = GEOMETRIES.find((candidate) => candidate.id === id);
    if (found === undefined) throw new Error(`no geometry named ${id}`);
    return found;
}

/** The two geometries every non-default axis is sampled at, one narrow and one wide. */
export const DETAIL_GEOMETRIES: readonly Geometry[] = [geometry("phone"), geometry("laptop")];

/** Geometries that only run against the screens carrying a text field. */
const FIELD_ONLY = new Set(["keyboard", "phone-land"]);

/** Screens with a field to type into, which is what the two short geometries are testing. */
const FIELD_SCREENS = new Set(["login", "dashboard", "stack-new", "stack"]);

function fieldScreen(key: string): boolean {
    return FIELD_SCREENS.has(key) || key.startsWith("settings-");
}

export const THEMES: readonly Theme[] = ["light", "dark"];

export const REFLOW_GEOMETRY = "reflow";

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
    geometry: string;
    width: number;
    height: number;
    /** Emulated as a touchscreen, which is what makes `pointer: coarse` match. */
    touch: boolean;
    theme: Theme;
    locale: string;
    anonymous: boolean;
    /** When set, only these rules run. The reflow geometry is the only cell that sets it. */
    only: string[] | null;
}

function cell(
    screen: ScreenDefinition,
    scenario: ScenarioName,
    where: Geometry,
    theme: Theme,
    locale: string,
): Cell | null {
    if (FIELD_ONLY.has(where.id) && !fieldScreen(screen.key)) return null;
    const path = screen.path(scenario);
    if (path === null) return null;
    const parts = [screen.key, theme, where.id];
    if (locale !== DEFAULT_LOCALE) parts.push(locale);
    if (scenario !== "typical") parts.push(scenario);
    return {
        id: parts.join("."),
        screen: screen.key,
        path,
        scenario,
        geometry: where.id,
        width: where.width,
        height: where.height,
        touch: where.touch,
        theme,
        locale,
        anonymous: screen.anonymous === true,
        only: where.id === REFLOW_GEOMETRY ? REFLOW_RULES : null,
    };
}

/**
 * The layout matrix: every screen at every geometry in English, both themes; every screen at the two
 * detail geometries in the pseudo-locale and the right-to-left locale; and the four extra scenarios
 * at the same two. A full cross product would be several thousand cells for no extra coverage.
 */
export function layoutMatrix(): Cell[] {
    const cells: Cell[] = [];
    for (const screen of SCREENS) {
        for (const where of GEOMETRIES) {
            for (const theme of THEMES) {
                const made = cell(screen, "typical", where, theme, DEFAULT_LOCALE);
                if (made !== null) cells.push(made);
            }
        }
        for (const where of DETAIL_GEOMETRIES) {
            for (const locale of [PSEUDO_LOCALE, RTL_LOCALE]) {
                const made = cell(screen, "typical", where, "light", locale);
                if (made !== null) cells.push(made);
            }
            for (const scenario of EXTRA_SCENARIOS) {
                const made = cell(screen, scenario, where, "light", DEFAULT_LOCALE);
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
