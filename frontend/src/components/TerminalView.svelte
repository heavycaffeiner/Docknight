<script lang="ts">
    import { FitAddon } from "@xterm/addon-fit";
    import { WebLinksAddon } from "@xterm/addon-web-links";
    import { Terminal } from "@xterm/xterm";
    import "@xterm/xterm/css/xterm.css";
    import { connection, on, request } from "../lib/connection.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { theme } from "../lib/stores/theme.svelte.ts";

    /**
     * Joins `terminal` on `endpoint`, replays its buffer, streams output, and reports resizes.
     * `interactive` enables keyboard input. `rows` sets the initial height before the first fit.
     */
    interface Props {
        endpoint: string;
        terminal: string;
        interactive?: boolean;
        rows?: number;
        label?: string;
    }

    const { endpoint, terminal, interactive = false, rows = 20, label }: Props = $props();

    let host = $state<HTMLElement | null>(null);
    let exited = $state(false);
    let exitCode = $state<number | null>(null);

    function readVar(name: string): string {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value === "" ? "0 0 0" : value;
    }

    /** The renderer takes colours as values, not as custom properties, so it is rebuilt on change. */
    function palette(): Record<string, string> {
        const rgb = (name: string): string => {
            const [r, g, b] = readVar(name).split(/\s+/);
            return `rgb(${r ?? 0}, ${g ?? 0}, ${b ?? 0})`;
        };
        const dark = theme.resolved === "dark";
        return {
            background: rgb("--m3-scheme-surface-container-lowest"),
            foreground: rgb("--m3-scheme-on-surface"),
            cursor: rgb("--m3-scheme-primary"),
            selectionBackground: rgb("--m3-scheme-secondary-container"),
            black: dark ? "#3c4043" : "#202124",
            red: dark ? "#f28b82" : "#c5221f",
            green: dark ? "#81c995" : "#137333",
            yellow: dark ? "#fdd663" : "#a56200",
            blue: dark ? "#8ab4f8" : "#1a73e8",
            magenta: dark ? "#d7aefb" : "#8430ce",
            cyan: dark ? "#78d9ec" : "#007b83",
            white: dark ? "#e8eaed" : "#f1f3f4",
        };
    }

    let view = $state<Terminal | null>(null);
    let fit: FitAddon | null = null;

    $effect(() => {
        if (host === null) return undefined;

        const created = new Terminal({
            rows,
            cols: 105,
            convertEol: false,
            cursorBlink: interactive,
            disableStdin: !interactive,
            scrollback: 5000,
            allowProposedApi: true,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 13,
            lineHeight: 1.54,
            smoothScrollDuration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? 0
                : 100,
            theme: palette(),
        });

        fit = new FitAddon();
        created.loadAddon(fit);
        created.loadAddon(new WebLinksAddon());
        created.open(host);
        view = created;

        return () => {
            view = null;
            fit = null;
            created.dispose();
        };
    });

    /**
     * Rejoining is keyed on the connection generation, because the pty lives on the server and
     * outlives the socket: a reconnect replays its buffer into the same pane rather than losing it.
     */
    $effect(() => {
        const current = view;
        const container = host;
        const generation = connection.generation;
        if (current === null || container === null) return undefined;

        let disposed = false;
        const unsubscribes: (() => void)[] = [];

        const attach = async (): Promise<void> => {
            try {
                const result = await request(endpoint, "terminal.join", { terminal });
                if (disposed) return;
                current.clear();
                if (result.buffer !== "") current.write(result.buffer);
                exited = result.exited;
                exitCode = result.exitCode;
            } catch {
                // An empty pane is the documented outcome for a terminal that does not exist yet.
            }
        };

        void attach();

        unsubscribes.push(
            on("terminalWrite", (eventEndpoint, payload) => {
                if (eventEndpoint !== endpoint || payload.terminal !== terminal) return;
                current.write(payload.data);
            }),
        );
        unsubscribes.push(
            on("terminalExit", (eventEndpoint, payload) => {
                if (eventEndpoint !== endpoint || payload.terminal !== terminal) return;
                exited = true;
                exitCode = payload.exitCode;
            }),
        );

        if (interactive) {
            const input = current.onData((data) => {
                void request(endpoint, "terminal.input", { terminal, data }).catch(() => undefined);
            });
            unsubscribes.push(() => input.dispose());
        }

        const observer = new ResizeObserver(() => {
            try {
                fit?.fit();
            } catch {
                return;
            }
            void request(endpoint, "terminal.resize", {
                terminal,
                cols: current.cols,
                rows: current.rows,
            }).catch(() => undefined);
        });
        observer.observe(container);

        return () => {
            disposed = true;
            observer.disconnect();
            for (const unsubscribe of unsubscribes) unsubscribe();
            // Leaving on a reconnect would read as the last viewer departing, which closes the
            // shell the rejoin above is about to ask for.
            if (connection.generation === generation) {
                void request(endpoint, "terminal.leave", { terminal }).catch(() => undefined);
            }
        };
    });

    // The renderer holds colour values rather than tokens, so a theme change is pushed in.
    $effect(() => {
        const current = view;
        void theme.resolved;
        if (current === null) return;
        current.options.theme = palette();
    });
</script>

<div class="wrap" data-audit-id="terminal-pane" data-audit-volatile>
    <div
        class="surface"
        style:--_terminal-rows={rows}
        bind:this={host}
        role="group"
        aria-label={label ?? t("terminalLabel")}
        aria-describedby="terminal-help-{terminal}"
        data-audit-id="terminal-surface"
    ></div>
    <p id="terminal-help-{terminal}" class="visually-hidden">{t("terminalDescription")}</p>
    {#if exited}
        <p class="exit type-label">exit {exitCode ?? 0}</p>
    {/if}
</div>

<style>
    .wrap {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    /*
     * The pane is a fixed number of allotted rows, so its box lands on the grid; the fit addon then
     * packs as many character cells as the font metrics allow into that box, and the leftover sliver
     * is clipped. The cells are the second documented exception to the grid, the box is not.
     */
    .surface {
        block-size: calc(var(--_terminal-rows) * var(--size-terminal-line) + 2 * var(--space-3));
        padding: var(--space-3);
        border-radius: var(--radius-md);
        background-color: rgb(var(--m3-scheme-surface-container-lowest));
        overflow: hidden;
    }

    .exit {
        margin: 0;
        color: rgb(var(--m3-scheme-on-surface-variant));
    }
</style>
