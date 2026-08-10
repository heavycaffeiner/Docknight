import js from "@eslint/js";
import globals from "globals";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";
import svelteConfig from "./svelte.config.js";

/** Backend and common run through Node's type stripper, so no syntax needing code generation. */
const erasableOnly = {
    "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "Enums need code generation; use a const object." },
        { selector: "TSModuleDeclaration", message: "Namespaces need code generation." },
        {
            selector: "TSParameterProperty",
            message: "Parameter properties need code generation; assign in the body.",
        },
    ],
};

export default tseslint.config(
    {
        ignores: [
            "dist/**",
            ".dev/**",
            "node_modules/**",
            "test-results/**",
            "frontend/src/styles/theme.css",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            eqeqeq: ["error", "always", { null: "ignore" }],
            "no-console": "error",
        },
    },
    {
        files: ["common/**/*.ts"],
        languageOptions: { globals: {} },
        rules: {
            ...erasableOnly,
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/backend/**", "**/frontend/**"],
                            message: "common/ may not import from backend/ or frontend/.",
                        },
                        { group: ["node:*"], message: "common/ runs in the browser too; no Node APIs." },
                    ],
                },
            ],
        },
    },
    {
        files: [
            "backend/**/*.ts",
            "scripts/**/*.ts",
            "tools/**/*.ts",
            "tests/**/*.ts",
            "vite.config.ts",
            "vite.audit.config.ts",
            "playwright.config.ts",
        ],
        languageOptions: { globals: globals.node },
        rules: {
            ...erasableOnly,
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        { group: ["**/frontend/**"], message: "backend/ may not import from frontend/." },
                    ],
                },
            ],
        },
    },
    {
        files: [
            "scripts/**/*.ts",
            "tools/**/*.ts",
            "tools/**/*.svelte",
            "docker/**/*.ts",
            "tests/**/*.ts",
        ],
        rules: { "no-console": "off" },
    },
    {
        // Tests run under node:test, so the no-Node-APIs rule for common/ does not apply to them.
        files: ["**/*.test.ts"],
        rules: { "no-restricted-imports": "off" },
    },
    {
        // The stylelint plugins are CommonJS because that is what stylelint's plugin host loads.
        files: ["**/*.cjs"],
        languageOptions: { globals: { ...globals.node, ...globals.commonjs } },
        rules: {
            "@typescript-eslint/no-require-imports": "off",
            "no-undef": "off",
        },
    },
    ...svelte.configs.recommended,
    {
        // tools/overlay and tools/audit are browser code even though they live under tools/.
        files: [
            "frontend/**/*.ts",
            "frontend/**/*.svelte",
            "tools/overlay/**/*.ts",
            "tools/overlay/**/*.svelte",
            "tools/audit/**/*.ts",
        ],
        languageOptions: {
            globals: globals.browser,
            parserOptions: {
                extraFileExtensions: [".svelte"],
                parser: tseslint.parser,
                svelteConfig,
            },
        },
        rules: {
            "svelte/no-target-blank": "error",
            "svelte/require-each-key": "error",
            "svelte/button-has-type": "error",
            /*
             * The Maps and Sets in the stores are bookkeeping the UI never reads reactively:
             * subscription registries, in-flight request tables, and locally scoped grouping. A
             * reactive collection there would cost re-renders for nothing.
             */
            "svelte/prefer-svelte-reactivity": "off",
            // Proposal 8, section 4.3.1: dynamic geometry goes through a custom property.
            "no-restricted-syntax": [
                "error",
                {
                    selector:
                        "SvelteAttribute[key.name='style'] SvelteLiteral[value=/[0-9](px|rem|em|vh|vw|%)/]",
                    message: "No lengths in a style attribute; set a CSS custom property from a token.",
                },
            ],
        },
    },
    {
        /*
         * i18n warns once per missing key in development, per proposal 6. events.ts warns when the
         * served bundle and the server disagree on the version, which is the operator's signal that
         * a rebuild is missing.
         */
        files: ["frontend/src/lib/stores/i18n.svelte.ts", "frontend/src/lib/events.ts"],
        rules: { "no-console": "off" },
    },
);
