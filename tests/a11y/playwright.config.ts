import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: ".",
    timeout: 30_000,
    fullyParallel: true,
    // Matches tests/layout/playwright.config.ts's reasoning: one shared Chromium instance per
    // worker, and a worker count near the CPU count made its context churn flaky in this sandbox.
    workers: 4,
    retries: 1,
    reporter: [["list"]],
    use: {
        // The harness manages its own browser, context, and navigation per cell; Playwright's
        // own page fixture is unused, so no baseURL or default context settings apply here.
    },
});
