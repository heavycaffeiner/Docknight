<script lang="ts">
    import { FitAddon } from "@xterm/addon-fit";
    import { WebLinksAddon } from "@xterm/addon-web-links";
    import { Terminal } from "@xterm/xterm";
    import "@xterm/xterm/css/xterm.css";
    import { generation, on, request } from "../lib/connection.svelte.ts";
    import { theme } from "../lib/stores/theme.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";

    interface Props {
        endpoint: string;
        terminal: string;
        interactive: boolean;
        rows: number;
    }

    let { endpoint, terminal, interactive, rows }: Props = $props();

    let container = $state<HTMLDivElement | null>(null);
    let term: Terminal | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let unsubscribeWrite: (() => void) | null = null;
    let unsubscribeExit: (() => void) | null = null;
    let lastGeneration = -1;

    function paletteFor(resolved: "light" | "dark"): Record<string, string> {
        return resolved === "dark"
            ? { background: "#1c1b1f", foreground: "#e6e0e9" }
            : { background: "#fdf7ff", foreground: "#1d1b20" };
    }

    async function joinAndReplay(): Promise<void> {
        if (term === null) return;
        const result = await request(endpoint, "terminal.join", { terminal });
        term.write(result.buffer);
        if (result.exited && result.exitCode !== null) {
            term.write(`\r\n[exit code ${result.exitCode}]\r\n`);
        }
    }

    $effect(() => {
        if (container === null) return;
        const instance = new Terminal({
            theme: paletteFor(theme.resolved),
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 13,
            lineHeight: 20 / 13,
            rows,
            cursorBlink: interactive,
            disableStdin: !interactive,
        });
        const fit = new FitAddon();
        instance.loadAddon(fit);
        instance.loadAddon(new WebLinksAddon());
        instance.open(container);
        term = instance;

        void joinAndReplay();

        unsubscribeWrite = on("terminalWrite", (evtEndpoint, data) => {
            if (evtEndpoint !== endpoint || data.terminal !== terminal) return;
            instance.write(data.data);
        });
        unsubscribeExit = on("terminalExit", (evtEndpoint, data) => {
            if (evtEndpoint !== endpoint || data.terminal !== terminal) return;
            instance.write(`\r\n[exit code ${data.exitCode}]\r\n`);
        });

        resizeObserver = new ResizeObserver(() => {
            fit.fit();
            void request(endpoint, "terminal.resize", { terminal, cols: instance.cols, rows: instance.rows });
        });
        resizeObserver.observe(container);

        if (interactive) {
            instance.onData((data) => {
                void request(endpoint, "terminal.input", { terminal, data });
            });
        }

        lastGeneration = generation.value;

        return () => {
            // Explicit navigation away; the leave is intentional, not a reconnect.
            void request(endpoint, "terminal.leave", { terminal }).catch(() => undefined);
            unsubscribeWrite?.();
            unsubscribeExit?.();
            resizeObserver?.disconnect();
            instance.dispose();
            term = null;
        };
    });

    $effect(() => {
        // A reconnect: re-join WITHOUT leaving first, so a private shell being rejoined is not
        // torn down by the departure the previous connection's teardown never got to run.
        if (generation.value !== lastGeneration && lastGeneration !== -1) {
            lastGeneration = generation.value;
            void joinAndReplay();
        }
    });

    $effect(() => {
        if (term !== null) term.options.theme = paletteFor(theme.resolved);
    });
</script>

<div
    bind:this={container}
    class="terminal-surface"
    data-audit-id="terminal-surface"
    data-audit-exempt-grid
    data-audit-opaque
    role="log"
    aria-label={t("terminal.output")}
></div>

<style>
    /*
     * Character-cell metrics are the proposal 6 exception: the container padding is a token,
     * but the terminal's internal geometry comes from the monospace font, not the grid.
     */
    .terminal-surface {
        padding: var(--space-2);
        border-radius: var(--radius-sm);
        background: var(--m3c-surface-container-lowest);
        overflow: hidden;

        /*
         * A terminal's own content is always left-to-right regardless of the page's own
         * direction; xterm.js lays out its internal viewport assuming that, and inheriting rtl
         * from an Arabic-locale page instead made it size its rows to an absurd width.
         */
        direction: ltr;
    }
</style>
