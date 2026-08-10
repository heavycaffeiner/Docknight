"use strict";

module.exports = {
    plugins: ["./tools/stylelint/grid-tokens.cjs", "./tools/stylelint/logical-properties.cjs"],
    overrides: [
        {
            files: ["**/*.svelte"],
            customSyntax: "postcss-html",
        },
    ],
    rules: {
        "docknight/grid-tokens": true,
        "docknight/logical-properties": true,
        "declaration-property-value-no-unknown": true,
        "no-duplicate-selectors": true,
        "color-no-invalid-hex": true,
        "length-zero-no-unit": true,
    },
    /*
     * tokens.css declares the scale, so it is the one file that writes raw lengths. The
     * development overlay draws outlines at measured coordinates and is deliberately off the grid;
     * it never ships in a production build.
     */
    ignoreFiles: [
        "dist/**",
        "node_modules/**",
        "frontend/src/styles/tokens.css",
        "frontend/src/styles/theme.css",
        "tools/overlay/**",
    ],
};
