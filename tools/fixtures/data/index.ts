import dense from "./dense.ts";
import degraded from "./degraded.ts";
import empty from "./empty.ts";
import extreme from "./extreme.ts";
import singleStack from "./single-stack.ts";
import slow from "./slow.ts";
import typical from "./typical.ts";
import type { Scenario, ScenarioName } from "./types.ts";

export const SCENARIOS: Record<ScenarioName, Scenario> = {
    typical,
    empty,
    "single-stack": singleStack,
    dense,
    extreme,
    degraded,
    slow,
};

export function loadScenario(name: ScenarioName): Scenario {
    return SCENARIOS[name];
}

export type { Scenario, ScenarioName } from "./types.ts";
