export default {
    plugins: ["./tools/stylelint/grid-tokens.mjs", "./tools/stylelint/logical-properties.mjs"],
    extends: ["stylelint-config-standard"],
    overrides: [
        {
            files: ["**/*.svelte"],
            customSyntax: "postcss-html",
        },
    ],
    rules: {
        "docknight/grid-tokens": true,
        "docknight/logical-properties": true,
        // Svelte's scoped-class attribute selectors are not part of the standard grammar.
        "selector-class-pattern": null,
        "custom-property-pattern": null,
        "no-empty-source": null,
        // Svelte's :global() escapes component style scoping; it is not a real CSS pseudo-class,
        // but stylelint's Svelte support only strips it from simple selectors, not from every
        // position it appears in (nested, or on an ancestor combinator).
        "selector-pseudo-class-no-unknown": [true, { ignorePseudoClasses: ["global"] }],
    },
};
