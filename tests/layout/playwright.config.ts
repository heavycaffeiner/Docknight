import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: ".",
    timeout: 30_000,
    fullyParallel: true,
    // Every cell shares one Chromium instance per worker (tests/support/harness.ts); a worker
    // count near the CPU count made that instance's context churn flaky under this sandbox's
    // resource limits. A moderate cap trades some wall-clock time for reliability.
    workers: 4,
    retries: 1,
    reporter: [["list"]],
    use: {
        // The harness manages its own browser, context, and navigation per cell; Playwright's
        // own page fixture is unused, so no baseURL or default context settings apply here.
    },
});
