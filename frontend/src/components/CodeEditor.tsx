import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { yaml } from "@codemirror/lang-yaml";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { type ReactElement, useEffect, useRef } from "react";
import { useMediaQuery } from "../lib/media.ts";
import { useStore } from "../lib/store.ts";
import { themePreference } from "../lib/theme.ts";

interface Props {
    value: string;
    onChange: (value: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    ariaLabel: string;
    readOnly?: boolean;
}

function editableFor(readOnly: boolean): Extension {
    return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

/**
 * One rule set for both modes: every colour is an mdui token, which already swaps with the
 * theme attribute, so only CodeMirror's own `dark` flag differs between the two.
 */
const RULES = {
    "&": {
        height: "100%",
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: "13px",
        lineHeight: "1.5",
        backgroundColor: "rgb(var(--mdui-color-surface-container-lowest))",
        color: "rgb(var(--mdui-color-on-surface))",
    },
    ".cm-scroller": { fontFamily: "inherit" },
    ".cm-content": { padding: "0.5rem 0", caretColor: "rgb(var(--mdui-color-primary))" },
    ".cm-gutters": {
        backgroundColor: "rgb(var(--mdui-color-surface-container-lowest))",
        color: "rgb(var(--mdui-color-on-surface-variant))",
        border: "none",
        paddingInlineEnd: "0.5rem",
    },
    ".cm-activeLine": { backgroundColor: "rgba(var(--mdui-color-surface-container), 0.6)" },
    ".cm-activeLineGutter": {
        backgroundColor: "rgba(var(--mdui-color-surface-container), 0.6)",
        color: "rgb(var(--mdui-color-on-surface))",
    },
    "&.cm-focused .cm-cursor": { borderLeftColor: "rgb(var(--mdui-color-primary))" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: "rgb(var(--mdui-color-secondary-container))",
    },
    // The scroller is focusable for WCAG 2.1.1, so it keeps a visible ring for 2.4.7.
    "&.cm-focused": {
        outline: "2px solid rgb(var(--mdui-color-primary))",
        outlineOffset: "-2px",
    },
};

const darkTheme = EditorView.theme(RULES, { dark: true });
const lightTheme = EditorView.theme(RULES);

/**
 * Syntax colours come from the same mdui roles as the rest of the app, so they follow the
 * theme without a second palette to keep in sync. CodeMirror's stock highlight style is
 * tuned for a light surface and is unreadable on the dark one.
 */
const highlight = HighlightStyle.define([
    { tag: [tags.comment], color: "rgb(var(--mdui-color-on-surface-variant))", fontStyle: "italic" },
    { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "rgb(var(--mdui-color-primary))" },
    { tag: [tags.keyword, tags.atom, tags.bool, tags.null], color: "rgb(var(--mdui-color-tertiary))" },
    { tag: [tags.string, tags.special(tags.string)], color: "rgb(var(--mdui-color-secondary))" },
    { tag: [tags.number], color: "rgb(var(--mdui-color-tertiary))" },
    { tag: [tags.operator, tags.punctuation, tags.separator], color: "rgb(var(--mdui-color-on-surface-variant))" },
    { tag: [tags.invalid], color: "rgb(var(--mdui-color-error))" },
]);

function paletteFor(resolved: "light" | "dark"): Extension {
    return [resolved === "dark" ? darkTheme : lightTheme, syntaxHighlighting(highlight, { fallback: true })];
}

/**
 * A CodeMirror 6 instance owned by an effect rather than by React's render output: CodeMirror
 * manages its own DOM subtree, so React only ever mounts and unmounts the container it lives
 * in. The document and the theme are pushed in through separate effects instead of tearing the
 * editor down, so neither a keystroke echoed back nor a theme change loses cursor position or
 * undo history.
 */
export default function CodeEditor({
    value,
    onChange,
    onFocus,
    onBlur,
    ariaLabel,
    readOnly = false,
}: Props): ReactElement {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const themeCompartment = useRef<Compartment | null>(null);
    const editableCompartment = useRef<Compartment | null>(null);
    themeCompartment.current ??= new Compartment();
    editableCompartment.current ??= new Compartment();

    const preference = useStore(themePreference);
    const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
    const resolved: "light" | "dark" = preference === "auto" ? (systemDark ? "dark" : "light") : preference;

    // Read through refs inside the update listener so the editor can be created once and never
    // has to be recreated just because the parent re-rendered with a new closure.
    const onChangeRef = useRef(onChange);
    const onFocusRef = useRef(onFocus);
    const onBlurRef = useRef(onBlur);
    useEffect(() => {
        onChangeRef.current = onChange;
        onFocusRef.current = onFocus;
        onBlurRef.current = onBlur;
    });

    useEffect(() => {
        const container = containerRef.current;
        const theme = themeCompartment.current;
        const editable = editableCompartment.current;
        if (container === null || theme === null || editable === null) return;
        const state = EditorState.create({
            doc: value,
            extensions: [
                lineNumbers(),
                highlightActiveLineGutter(),
                highlightActiveLine(),
                history(),
                keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
                yaml(),
                // Compose lines are long and a phone is narrow: wrap rather than scroll.
                EditorView.lineWrapping,
                theme.of(paletteFor(resolved)),
                editable.of(editableFor(readOnly)),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) onChangeRef.current(update.state.doc.toString());
                    if (update.focusChanged) {
                        if (update.view.hasFocus) onFocusRef.current?.();
                        else onBlurRef.current?.();
                    }
                }),
                EditorView.contentAttributes.of({
                    "aria-label": ariaLabel,
                    "aria-description":
                        "Press Escape then Tab to leave the editor instead of inserting a tab character.",
                }),
            ],
        });
        // `root` is passed explicitly because CodeMirror otherwise derives it by walking
        // `assignedSlot`, which lands on the shadow root of whichever mdui component the
        // editor happens to be slotted into. Its stylesheet would then be adopted there and
        // never reach this light-DOM subtree, and the editor would render unstyled.
        const instance = new EditorView({ state, parent: container, root: document });
        // CodeMirror's scroll container must be keyboard focusable for WCAG 2.1.1.
        instance.scrollDOM.tabIndex = 0;
        viewRef.current = instance;
        return () => {
            instance.destroy();
            viewRef.current = null;
        };
        // Runs once per mount only: the initial value, aria label, theme, and read-only state
        // are captured here; later changes flow through the effects below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const view = viewRef.current;
        if (view === null) return;
        const current = view.state.doc.toString();
        if (current !== value && !view.hasFocus) {
            view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
        }
    }, [value]);

    useEffect(() => {
        const view = viewRef.current;
        const theme = themeCompartment.current;
        if (view === null || theme === null) return;
        view.dispatch({ effects: theme.reconfigure(paletteFor(resolved)) });
    }, [resolved]);

    useEffect(() => {
        const view = viewRef.current;
        const editable = editableCompartment.current;
        if (view === null || editable === null) return;
        view.dispatch({ effects: editable.reconfigure(editableFor(readOnly)) });
    }, [readOnly]);

    // The container carries the height: CodeMirror fills its parent, so a parent sized only
    // by its content collapses the editor to nothing.
    return <div ref={containerRef} className="code-editor" />;
}
