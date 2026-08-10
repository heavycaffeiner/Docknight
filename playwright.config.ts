import { defineConfig, devices } from "@playwright/test";
import { SCENARIO_PORTS } from "./tests/support/matrix.ts";

const CI = process.env.CI === "true" || process.env.CI === "1";

/**
 * One fixture backend per scenario, each serving the built frontend from its own origin so a cell
 * is addressed by port alone. Playwright owns their lifecycle, which keeps sharded runs honest.
 */
const webServer = Object.entries(SCENARIO_PORTS).map(([scenario, port]) => ({
    command: `node tools/fixtures/serve.ts --scenario ${scenario} --port ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !CI,
    timeout: 60_000,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
}));

export default defineConfig({
    testDir: "tests",
    outputDir: "test-results/artifacts",
    fullyParallel: true,
    forbidOnly: CI,
    retries: 0,
    workers: CI ? 4 : undefined,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: [
        ["list"],
        ["./tools/audit/report.ts", { outputFile: "test-results/verification-report.html" }],
    ],
    use: {
        ...devices["Desktop Chrome"],
        // The audit measures in CSS pixels, so the device pixel ratio has to be pinned.
        deviceScaleFactor: 1,
        colorScheme: "light",
        timezoneId: "UTC",
        trace: "retain-on-failure",
    },
    projects: [
        { name: "layout", testDir: "tests/layout" },
        { name: "a11y", testDir: "tests/a11y" },
    ],
    webServer,
});
