import { parseArgs } from "node:util";
import { SCENARIOS, type ScenarioName } from "./data/index.ts";
import { startFixtureServer } from "./server.ts";

const { values } = parseArgs({
    options: {
        scenario: { type: "string", default: "typical" },
        port: { type: "string", default: "5001" },
    },
});

const scenario = values.scenario as string;
if (!(scenario in SCENARIOS)) {
    process.stderr.write(
        `docknight-fixtures: unknown scenario "${scenario}", expected one of ${Object.keys(SCENARIOS).join(", ")}\n`,
    );
    process.exit(1);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`docknight-fixtures: invalid port ${JSON.stringify(values.port)}\n`);
    process.exit(1);
}

const server = await startFixtureServer(scenario as ScenarioName, port);
process.stdout.write(`docknight-fixtures: serving "${scenario}" on ws://127.0.0.1:${server.port}/ws\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        void server.close().then(() => process.exit(0));
    });
}
