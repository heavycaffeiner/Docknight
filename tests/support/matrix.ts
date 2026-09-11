import { SCENARIOS, type ScenarioName } from "../../tools/fixtures/data/index.ts";

/** Viewport geometry. Height is what a keyboard takes and what landscape has none of. */
export interface Geometry {
    id: string;
    width: number;
    height: number;
    touch: boolean;
}

export const GEOMETRIES: readonly Geometry[] = [
    { id: "phone", width: 390, height: 844, touch: true },
    { id: "phone-land", width: 780, height: 390, touch: true },
    { id: "keyboard", width: 390, height: 380, touch: true },
    { id: "tablet", width: 840, height: 1120, touch: true },
    { id: "laptop", width: 1280, height: 900, touch: false },
];

export type ScreenName =
    | "login"
    | "setup"
    | "dashboard"
    | "stack"
    | "resources"
    | "settings-general"
    | "settings-security";

/**
 * Path each screen resolves to in the fixture-served app; login and setup pre-empt auth. The
 * stack screen carries no path here: which stack exists is scenario data, so `screenPath`
 * resolves it per cell.
 */
export const SCREEN_PATHS: Record<Exclude<ScreenName, "stack">, string> = {
    login: "/",
    setup: "/",
    dashboard: "/",
    resources: "/resources/containers",
    "settings-general": "/settings/general",
    "settings-security": "/settings/security",
};

export function screenPath(cell: Cell): string {
    if (cell.screen !== "stack") return SCREEN_PATHS[cell.screen];
    const names = Object.keys(SCENARIOS[cell.scenario].stackDetails);
    const name = names[0];
    if (name === undefined) {
        throw new Error(`scenario "${cell.scenario}" serves no stack for the ${cell.screen} screen`);
    }
    return `/compose/${name}`;
}

export interface Cell {
    id: string;
    screen: ScreenName;
    geometry: Geometry;
    theme: "light" | "dark";
    locale: string;
    scenario: ScenarioName;
}

const SCREENS: ScreenName[] = [
    "login",
    "setup",
    "dashboard",
    "stack",
    "resources",
    "settings-general",
    "settings-security",
];

const A11Y_GEOMETRIES = ["phone", "laptop"];

function makeCell(
    screen: ScreenName,
    geometry: Geometry,
    theme: "light" | "dark",
    locale: string,
    scenario: ScenarioName,
): Cell {
    const localeSuffix = locale === "en" ? "" : `.${locale}`;
    const scenarioSuffix = scenario === "typical" ? "" : `.${scenario}`;
    return {
        id: `${screen}.${theme}.${geometry.id}${localeSuffix}${scenarioSuffix}`,
        screen,
        geometry,
        theme,
        locale,
        scenario,
    };
}

/** Every screen at phone and laptop, both themes: the sampling axis test:a11y runs on. */
export function a11yCells(): Cell[] {
    const result: Cell[] = [];
    const geometries = GEOMETRIES.filter((g) => A11Y_GEOMETRIES.includes(g.id));
    for (const screen of SCREENS) {
        for (const geometry of geometries) {
            result.push(makeCell(screen, geometry, "light", "en", "typical"));
            result.push(makeCell(screen, geometry, "dark", "en", "typical"));
        }
    }
    return result;
}
