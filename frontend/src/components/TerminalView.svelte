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
            ? { background: "#111318", foreground: "#e2e2e9" }
            : { background: "#f9f9ff", foreground: "#1a1b20" };
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
        fit.fit();
        term = instance;

        resizeObserver = new ResizeObserver(() => {
            fit.fit();
            if (interactive) {
                void request(endpoint, "terminal.resize", {
                    terminal,
                    cols: instance.cols,
                    rows: instance.rows,
                });
            }
        });
        resizeObserver.observe(container);

        if (interactive) {
            instance.onData((data) => {
                void request(endpoint, "terminal.input", { terminal, data });
            });
        }

        unsubscribeWrite = on("terminalWrite", (payload: { terminal: string; data: string }) => {
            if (payload.terminal === terminal) {
                instance.write(payload.data);
            }
        });

        unsubscribeExit = on("terminalExit", (payload: { terminal: string; exitCode: number }) => {
            if (payload.terminal === terminal) {
                instance.write(`\r\n[exit code ${payload.exitCode}]\r\n`);
            }
        });

        void joinAndReplay();

        return () => {
            unsubscribeWrite?.();
            unsubscribeExit?.();
            resizeObserver?.disconnect();
            instance.dispose();
            term = null;
        };
    });

    $effect(() => {
        if (generation.value !== lastGeneration) {
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
    class="gcp-terminal-surface"
    data-audit-id="terminal-surface"
    data-audit-exempt-grid
    data-audit-opaque
    data-audit-clip
    role="log"
    aria-label={t("terminal.output")}
></div>

<style>
    .gcp-terminal-surface {
        padding: var(--space-2);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);

        /*
         * xterm parks its measurement and composition helpers at absolute offsets outside this
         * box; clipping them is the point of the hidden overflow, hence data-audit-clip on the
         * element. Without it the auditor reads those helpers as an unintended overflow.
         */
        overflow: hidden;

        /*
         * A terminal's own content is always left-to-right regardless of the page's own
         * direction; xterm.js lays out its internal viewport assuming that, and inheriting rtl
         * from an Arabic-locale page instead made it size its rows to an absurd width.
         */
        direction: ltr;
    }
</style>
