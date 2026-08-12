<script lang="ts">
    import { indentLess, indentMore, redo, undo } from "@codemirror/commands";
    import { yaml } from "@codemirror/lang-yaml";
    import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
    import { ChangeSet, Compartment, EditorState } from "@codemirror/state";
    import { EditorView, keymap, type Command } from "@codemirror/view";
    import { tags } from "@lezer/highlight";
    import { basicSetup } from "codemirror";
    import { Button } from "m3-svelte";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { theme } from "../lib/stores/theme.svelte.ts";
    import Icon from "./Icon.svelte";

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

    interface Tool {
        id: string;
        label: string;
        icon: "undo" | "redo" | "indent" | "outdent";
        command: Command;
    }

    /* A touch keyboard has no Tab that indents and no Ctrl for undo, so the two edits a compose file
       needs most often are given buttons. */
    const TOOLS: Tool[] = $derived([
        { id: "undo", label: t("editorUndo"), icon: "undo", command: undo },
        { id: "redo", label: t("editorRedo"), icon: "redo", command: redo },
        { id: "indent", label: t("editorIndent"), icon: "indent", command: indentMore },
        { id: "outdent", label: t("editorOutdent"), icon: "outdent", command: indentLess },
    ]);

    function run(command: Command): void {
        const current = view;
        if (current === null) return;
        command(current);
        current.focus();
    }

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
                // A compose file has lines longer than a phone is wide, and a horizontal scrollbar
                // inside a vertical one is unusable on touch.
                EditorView.lineWrapping,
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
                    if (update.focusChanged) {
                        // A refocus is a fresh intent to type, so it clears a leftover Escape.
                        if (update.view.hasFocus) escaped = false;
                        onfocuschange?.(update.view.hasFocus);
                    }
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
    // not fight the store. The selection is mapped through the change rather than dropped, so an
    // external write (a form edit echoing into the compose editor) leaves the caret where it maps
    // instead of throwing it to the end of the document.
    $effect(() => {
        const current = view;
        if (current === null) return;
        if (current.state.doc.toString() === value) return;
        const changes = { from: 0, to: current.state.doc.length, insert: value };
        const changeSet = ChangeSet.of([changes], current.state.doc.length);
        current.dispatch({
            changes,
            selection: current.state.selection.map(changeSet),
        });
    });

    $effect(() => {
        view?.dispatch({ effects: dark.reconfigure(darkExtension(theme.resolved)) });
    });

    $effect(() => {
        view?.dispatch({ effects: editable.reconfigure(editableExtension(readOnly)) });
    });
</script>

<div class="stack">
    <div class="editor" bind:this={host} data-audit-id={auditId} data-audit-clip></div>
    {#if !readOnly}
        <div class="tools" role="group" aria-label={t("editorToolsLabel")}>
            {#each TOOLS as tool (tool.id)}
                <Button
                    variant="tonal"
                    square
                    iconType="full"
                    aria-label={tool.label}
                    onclick={() => run(tool.command)}
                >
                    <Icon name={tool.icon} size="md" />
                </Button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .stack {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .tools {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
    }

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

    /* Wrapping trades width for height, so a screen with the height to spare gives it back. */
    @media (height >= 800px) {
        .editor :global(.cm-editor) {
            max-block-size: var(--measure-editor);
        }
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
