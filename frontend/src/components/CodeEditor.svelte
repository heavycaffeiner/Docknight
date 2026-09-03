<script lang="ts">
    import { Compartment, EditorState } from "@codemirror/state";
    import { EditorView, keymap, lineNumbers } from "@codemirror/view";
    import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
    import { yaml } from "@codemirror/lang-yaml";
    import { theme } from "../lib/stores/theme.svelte.ts";

    interface Props {
        value: string;
        oninput: (value: string) => void;
        onfocus?: () => void;
        onblur?: () => void;
        ariaLabel: string;
    }

    let { value, oninput, onfocus, onblur, ariaLabel }: Props = $props();

    let container = $state<HTMLDivElement | null>(null);
    let view: EditorView | null = null;
    const themeCompartment = new Compartment();

    const darkTheme = EditorView.theme(
        {
            "&": { backgroundColor: "var(--m3c-surface-container-lowest)", color: "var(--m3c-on-surface)" },
            ".cm-gutters": { backgroundColor: "var(--m3c-surface-container-low)", border: "none" },
        },
        { dark: true },
    );
    const lightTheme = EditorView.theme({
        "&": { backgroundColor: "var(--m3c-surface-container-lowest)", color: "var(--m3c-on-surface)" },
        ".cm-gutters": { backgroundColor: "var(--m3c-surface-container-low)", border: "none" },
    });

    function paletteFor(resolved: "light" | "dark"): ReturnType<typeof EditorView.theme> {
        return resolved === "dark" ? darkTheme : lightTheme;
    }

    $effect(() => {
        if (container === null) return;
        const state = EditorState.create({
            doc: value,
            extensions: [
                lineNumbers(),
                history(),
                keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
                yaml(),
                themeCompartment.of(paletteFor(theme.resolved)),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) oninput(update.state.doc.toString());
                    if (update.focusChanged) {
                        if (update.view.hasFocus) onfocus?.();
                        else onblur?.();
                    }
                }),
                EditorView.contentAttributes.of({
                    "aria-label": ariaLabel,
                    "aria-description":
                        "Press Escape then Tab to leave the editor instead of inserting a tab character.",
                }),
            ],
        });
        const instance = new EditorView({ state, parent: container });
        // CodeMirror's own scroll container is not focusable by default; axe-core's
        // scrollable-region-focusable rule (WCAG 2.1.1) requires every scrollable region to be
        // keyboard-reachable independent of its content, and .cm-content's own
        // contenteditable focus target does not satisfy that for the wrapping scroller.
        instance.scrollDOM.tabIndex = 0;
        view = instance;
        return () => {
            instance.destroy();
            view = null;
        };
    });

    // Programmatic updates (from the form-input sync direction) only, never firing while the
    // editor itself holds focus: the sync state machine's loop breaker depends on that.
    $effect(() => {
        if (view === null) return;
        const current = view.state.doc.toString();
        if (current !== value && !view.hasFocus) {
            view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
        }
    });

    $effect(() => {
        if (view === null) return;
        view.dispatch({ effects: themeCompartment.reconfigure(paletteFor(theme.resolved)) });
    });
</script>

<div
    bind:this={container}
    class="editor"
    data-audit-id="code-editor"
    data-audit-exempt-grid
    data-audit-opaque
></div>

<style>
    .editor {
        flex: 1;
        min-block-size: 0;
        overflow: auto;
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        font-family: "JetBrains Mono", monospace;
        font-size: 13px;
        line-height: var(--space-5);
    }

    .editor :global(.cm-editor) {
        block-size: 100%;
    }

    .editor :global(.cm-scroller) {
        font-family: inherit;
    }
</style>
