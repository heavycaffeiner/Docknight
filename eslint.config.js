import js from "@eslint/js";
import globals from "globals";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import tseslint from "typescript-eslint";

/**
 * Backend and common run through Node's type stripper, so no syntax needing code generation.
 * `TSModuleDeclaration[kind='namespace']` catches `namespace Foo {}` but not
 * `declare module "..." {}`, which is a type-only ambient augmentation the stripper erases
 * completely and which the protocol's method and event maps rely on.
 */
const erasableOnly = {
    "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "Enums need code generation; use a const object." },
        {
            selector: "TSModuleDeclaration[kind='namespace']",
            message: "Namespaces need code generation.",
        },
        {
            selector: "TSParameterProperty",
            message: "Parameter properties need code generation; assign in the body.",
        },
    ],
};

/** SQL is always a constant string; no value may be interpolated into a query. */
const sqlLiteralOnly = {
    "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "Enums need code generation; use a const object." },
        {
            selector: "TSModuleDeclaration[kind='namespace']",
            message: "Namespaces need code generation.",
        },
        {
            selector: "TSParameterProperty",
            message: "Parameter properties need code generation; assign in the body.",
        },
        {
            selector:
                "CallExpression[callee.name=/^(run|one|all|tx)$/] > TemplateLiteral[expressions.length > 0]",
            message: "SQL passed to run/one/all/tx must be a constant string; bind parameters instead.",
        },
    ],
};

export default tseslint.config(
    {
        ignores: ["dist/**", ".dev/**", "node_modules/**", "test-results/**"],
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
        files: ["backend/**/*.ts"],
        languageOptions: { globals: globals.node },
        rules: {
            ...sqlLiteralOnly,
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
        files: ["scripts/**/*.ts", "tests/**/*.ts"],
        languageOptions: { globals: globals.node },
        rules: { ...erasableOnly, "no-console": "off" },
    },
    {
        files: ["tools/**/*.ts", "tools/**/*.mjs"],
        languageOptions: { globals: globals.node },
        rules: { "no-console": "off" },
    },
    {
        // Tests run under node:test, so the no-Node-APIs rule for common/ does not apply to them.
        files: ["**/*.test.ts"],
        rules: { "no-restricted-imports": "off" },
    },
    {
        files: ["frontend/**/*.ts", "frontend/**/*.svelte"],
        languageOptions: { globals: globals.browser },
        rules: {
            ...erasableOnly,
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        { group: ["**/backend/**"], message: "frontend/ may not import from backend/." },
                    ],
                },
            ],
            "no-console": "off",
        },
    },
    ...svelte.configs["flat/recommended"].map((config) => ({
        ...config,
        files: ["frontend/**/*.svelte"],
    })),
    {
        files: ["frontend/**/*.svelte"],
        languageOptions: {
            parser: svelteParser,
            parserOptions: { parser: tseslint.parser, extraFileExtensions: [".svelte"] },
            globals: globals.browser,
        },
        rules: {
            // Svelte's own compiler emits a11y diagnostics (missing alt, missing label,
            // redundant role, and the rest); this surfaces them as lint errors instead of
            // build-time warnings a reviewer can miss.
            "svelte/valid-compile": ["error", { ignoreWarnings: false }],
            "no-restricted-syntax": [
                "error",
                {
                    selector: "SvelteAttribute[key.name='style'] SvelteLiteral[value=/\\d+(px|rem|em|vh|vw|%)/]",
                    message:
                        "dynamic geometry goes through a CSS custom property set from a token, not an inline style length",
                },
                {
                    selector:
                        "CallExpression[callee.object.name='window'][callee.property.name='matchMedia']",
                    message:
                        "media-query state must be reactive (a MediaQuery rune or a subscribed listener), never read once at mount",
                },
            ],
        },
    },
);
