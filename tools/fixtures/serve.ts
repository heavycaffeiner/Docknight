import { parseArgs } from "node:util";
import { SCENARIOS, type ScenarioName } from "./data/scenarios.ts";
import { startFixtureServer } from "./server.ts";
import { FIXTURE_PASSWORD, FIXTURE_USERNAME } from "./data/scenarios.ts";

const { values } = parseArgs({
    options: {
        scenario: { type: "string", default: "typical" },
        port: { type: "string", default: "5001" },
    },
    strict: true,
});

const scenario = values.scenario as string;
if (!Object.keys(SCENARIOS).includes(scenario)) {
    console.error(
        `unknown scenario ${scenario}. Available: ${Object.keys(SCENARIOS).join(", ")}`,
    );
    process.exit(1);
}

const port = Number(values.port);
const server = await startFixtureServer(scenario as ScenarioName, port);

console.log(`fixture backend on ws://127.0.0.1:${port}/ws with the ${scenario} scenario`);
console.log(`sign in as ${FIXTURE_USERNAME} / ${FIXTURE_PASSWORD}`);
console.log(
    `open http://127.0.0.1:${port}/ once the frontend is built, or run \`pnpm dev:frontend\`, whose dev server proxies /ws here`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        void server.close().then(() => process.exit(0));
    });
}
