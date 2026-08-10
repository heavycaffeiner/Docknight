import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Builds the auditor into one classic script so Playwright can drop it into a page with
 * addScriptTag. The application build never sees this config.
 */
export default defineConfig({
    build: {
        outDir: "dist/audit",
        emptyOutDir: true,
        target: "es2023",
        minify: false,
        lib: {
            entry: fileURLToPath(new URL("./tools/audit/inject.ts", import.meta.url)),
            name: "docknightAudit",
            formats: ["iife"],
            fileName: () => "audit.js",
        },
    },
});
