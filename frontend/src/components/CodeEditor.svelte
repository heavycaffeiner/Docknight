<script lang="ts">
    import { yaml } from "@codemirror/lang-yaml";
    import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
    import { Compartment, EditorState } from "@codemirror/state";
    import { EditorView, keymap } from "@codemirror/view";
    import { tags } from "@lezer/highlight";
    import { basicSetup } from "codemirror";
    import { theme } from "../lib/stores/theme.svelte.ts";

    /**
     * CodeMirror over one buffer. `onchange` fires on every document change; the caller decides
     * whether to debounce. `focused` is reported because the compose editor's sync uses focus as
     * its loop breaker.
     */
    interface Props {
        value: string;
        language?: "yaml" | "plain";
        readOnly?: boolean;
        ariaLabel: string;
        auditId: string;
        onchange?: (next: string) => void;
        onfocuschange?: (focused: boolean) => void;
    }

    const {
        value,
        language = "yaml",
        readOnly = false,
        ariaLabel,
        auditId,
        onchange,
        onfocuschange,
    }: Props = $props();

    let host = $state<HTMLElement | null>(null);
    let view: EditorView | null = null;
    const editable = new Compartment();
    const dark = new Compartment();

    /** Escape then Tab leaves the editor rather than inserting a tab character. */
    let escaped = false;

    function darkExtension(resolved: string) {
        return EditorView.theme({}, { dark: resolved === "dark" });
    }

    /**
     * A read-only editor drops contenteditable, which leaves its scroller unreachable by keyboard, so
     * the content takes the tab stop instead.
     */
    function editableExtension(locked: boolean) {
        return [
            EditorView.editable.of(!locked),
            ...(locked
                ? [EditorView.contentAttributes.of({ tabindex: "0", "aria-readonly": "true" })]
                : []),
        ];
    }

    /**
     * Tokens carry a class rather than a colour, so the palette lives in this component's stylesheet
     * and follows the scheme. CodeMirror's own highlight style is fixed light-mode hex and drops to
     * 2:1 on a dark surface.
     */
    const highlight = HighlightStyle.define([
        { tag: tags.comment, class: "tok-comment" },
        { tag: tags.string, class: "tok-string" },
        { tag: [tags.number, tags.bool, tags.null, tags.atom], class: "tok-literal" },
        { tag: [tags.keyword, tags.operatorKeyword], class: "tok-keyword" },
        { tag: [tags.propertyName, tags.definition(tags.propertyName)], class: "tok-key" },
        { tag: [tags.punctuation, tags.separator, tags.meta], class: "tok-punctuation" },
        { tag: tags.invalid, class: "tok-invalid" },
    ]);

    $effect(() => {
        if (host === null) return undefined;

        const state = EditorState.create({
            doc: value,
            extensions: [
                basicSetup,
                syntaxHighlighting(highlight),
                ...(language === "yaml" ? [yaml()] : []),
                editable.of(editableExtension(readOnly)),
                dark.of(darkExtension(theme.resolved)),
                keymap.of([
                    {
                        key: "Escape",
                        run: () => {
                            escaped = true;
                            return false;
                        },
                    },
                    {
                        key: "Tab",
                        run: (target) => {
                            if (!escaped) return false;
                            escaped = false;
                            target.contentDOM.blur();
                            return true;
                        },
                    },
                ]),
                EditorView.updateListener.of((update) => {
                    if (update.focusChanged) onfocuschange?.(update.view.hasFocus);
                    if (!update.docChanged) return;
                    onchange?.(update.state.doc.toString());
                }),
                EditorView.contentAttributes.of({
                    "aria-label": ariaLabel,
                    role: "textbox",
                    "aria-multiline": "true",
                }),
            ],
        });

        view = new EditorView({ state, parent: host });
        return () => {
            view?.destroy();
            view = null;
        };
    });

    // The buffer is replaced only when the incoming value genuinely differs, so a keystroke does
    // not fight the store.
    $effect(() => {
        const current = view;
        if (current === null) return;
        if (current.state.doc.toString() === value) return;
        current.dispatch({
            changes: { from: 0, to: current.state.doc.length, insert: value },
        });
    });

    $effect(() => {
        view?.dispatch({ effects: dark.reconfigure(darkExtension(theme.resolved)) });
    });

    $effect(() => {
        view?.dispatch({ effects: editable.reconfigure(editableExtension(readOnly)) });
    });
</script>

<div class="editor" bind:this={host} data-audit-id={auditId} data-audit-clip></div>

<style>
    .editor {
        position: relative;
        overflow: hidden;
        border: 0;
        border-radius: var(--radius-md);
        background-color: rgb(var(--m3-scheme-surface));
    }

    /* The ring is drawn over the content rather than under it: the gutter paints an opaque background
       at the inline start and would cover it. A border would work too, but adds a device pixel to the
       box on every side and takes it off the grid. */
    .editor::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 var(--hairline) rgb(var(--m3-scheme-outline));
        pointer-events: none;
    }

    .editor :global(.cm-editor) {
        max-block-size: var(--measure-form);
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 0.8125rem;
    }

    /* CodeMirror names the generic monospace family on the scroller and the gutters, which is more
       specific than inheriting from the editor and would leave the pane in whatever face the host
       happens to call monospace. */
    .editor :global(.cm-scroller) {
        font-family: inherit;
        line-height: var(--size-line-mono);
    }

    .editor :global(.cm-focused) {
        outline: none;
    }

    /* CodeMirror paints its own chrome from a light-mode default, so every surface a glyph sits on is
       set here instead. */
    .editor :global(.cm-content) {
        caret-color: rgb(var(--m3-scheme-on-surface));
        color: rgb(var(--m3-scheme-on-surface));
    }

    .editor :global(.cm-gutters) {
        border: 0;
        font-family: inherit;
        background-color: rgb(var(--m3-scheme-surface-container-low));
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .editor :global(.cm-activeLine) {
        background-color: rgb(var(--m3-scheme-surface-container));
    }

    .editor :global(.cm-activeLineGutter) {
        background-color: rgb(var(--m3-scheme-surface-container-high));
        color: rgb(var(--m3-scheme-on-surface));
    }

    .editor :global(.cm-cursor) {
        /* CodeMirror draws the caret as a left border in both directions, so the logical property
           would colour the side that is not painted. */
        /* stylelint-disable-next-line docknight/logical-properties */
        border-left-color: rgb(var(--m3-scheme-on-surface));
    }

    .editor :global(.cm-selectionBackground),
    .editor :global(.cm-focused .cm-selectionBackground),
    .editor :global(.cm-content ::selection) {
        background-color: rgb(var(--m3-scheme-secondary-container));
    }

    .editor :global(.cm-panels) {
        background-color: rgb(var(--m3-scheme-surface-container-high));
        color: rgb(var(--m3-scheme-on-surface));
    }

    .editor :global(.tok-comment) {
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .editor :global(.tok-string) {
        color: rgb(var(--m3-scheme-tertiary));
    }

    .editor :global(.tok-literal) {
        color: rgb(var(--m3-scheme-secondary));
    }

    .editor :global(.tok-keyword) {
        color: rgb(var(--m3-scheme-primary));
    }

    .editor :global(.tok-key) {
        color: rgb(var(--m3-scheme-on-surface));
        font-weight: 500;
    }

    .editor :global(.tok-punctuation) {
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .editor :global(.tok-invalid) {
        color: rgb(var(--m3-scheme-error));
    }
</style>
