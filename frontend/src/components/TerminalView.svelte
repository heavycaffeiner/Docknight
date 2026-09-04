<script lang="ts">
    import { onMount } from "svelte";
    import { Terminal } from "@xterm/xterm";
    import { FitAddon } from "@xterm/addon-fit";
    import { WebLinksAddon } from "@xterm/addon-web-links";
    import { request, on } from "../lib/connection.svelte.ts";
    import { theme } from "../lib/stores/theme.svelte.ts";
    import "@xterm/xterm/css/xterm.css";

    interface Props {
        endpoint?: string;
        terminal: string;
        interactive?: boolean;
        rows?: number;
    }

    let {
        endpoint = "",
        terminal,
        interactive = false,
        rows = 24,
    }: Props = $props();

    let container = $state<HTMLDivElement | null>(null);
    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let ctrlActive = $state(false);

    function getThemePalette(resolved: "light" | "dark") {
        if (resolved === "dark") {
            return {
                background: "#1e1e1e",
                foreground: "#d4d4d4",
                cursor: "#ffffff",
                selectionBackground: "#264f78",
                black: "#000000",
                red: "#cd3131",
                green: "#0dbc79",
                yellow: "#e5e510",
                blue: "#2472c8",
                magenta: "#bc3fbc",
                cyan: "#11a8cd",
                white: "#e5e5e5",
            };
        }
        return {
            background: "#ffffff",
            foreground: "#1f1f1f",
            cursor: "#000000",
            selectionBackground: "#add6ff",
            black: "#000000",
            red: "#cd3131",
            green: "#008000",
            yellow: "#795e26",
            blue: "#0451a5",
            magenta: "#811f3f",
            cyan: "#098658",
            white: "#ffffff",
        };
    }

    function sendKey(data: string): void {
        if (ctrlActive && data.length === 1) {
            const code = data.toUpperCase().charCodeAt(0);
            if (code >= 65 && code <= 90) {
                const ctrlCode = String.fromCharCode(code - 64);
                void request(endpoint, "terminal.input", { terminal, data: ctrlCode });
                ctrlActive = false;
                return;
            }
        }
        void request(endpoint, "terminal.input", { terminal, data });
    }

    $effect(() => {
        if (term !== null) {
            term.options.theme = getThemePalette(theme.resolved);
        }
    });

    onMount(() => {
        if (container === null) return;

        term = new Terminal({
            theme: getThemePalette(theme.resolved),
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 13,
            lineHeight: 20 / 13,
            rows,
            cursorBlink: interactive,
            disableStdin: !interactive,
        });
        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.open(container);

        try {
            fitAddon.fit();
        } catch {
            // ignore layout timing
        }

        void request<{ buffer?: string }>(endpoint, "terminal.join", { terminal })
            .then((res) => {
                if (res.buffer && term) {
                    term.write(res.buffer);
                }
            })
            .catch(() => {});

        const unsubWrite = on("terminalWrite", (payload: unknown) => {
            const data = payload as { endpoint?: string; terminal?: string; data?: string } | undefined;
            if (data?.terminal === terminal && (data?.endpoint ?? "") === endpoint && data?.data && term) {
                term.write(data.data);
            }
        });

        const unsubExit = on("terminalExit", (payload: unknown) => {
            const data = payload as { endpoint?: string; terminal?: string; code?: number } | undefined;
            if (data?.terminal === terminal && (data?.endpoint ?? "") === endpoint && term) {
                term.write(`\r\n[Process completed with code ${data.code ?? 0}]\r\n`);
            }
        });

        if (interactive) {
            term.onData((data) => {
                void request(endpoint, "terminal.input", { terminal, data });
            });
        }

        let resizeTimer: number | undefined;
        const ro = new ResizeObserver(() => {
            clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => {
                if (fitAddon && term) {
                    try {
                        fitAddon.fit();
                        void request(endpoint, "terminal.resize", {
                            terminal,
                            cols: term.cols,
                            rows: term.rows,
                        });
                    } catch {
                        // ignore unmounted fits
                    }
                }
            }, 100);
        });
        ro.observe(container);

        return () => {
            clearTimeout(resizeTimer);
            unsubWrite();
            unsubExit();
            ro.disconnect();
            void request(endpoint, "terminal.leave", { terminal }).catch(() => {});
            term?.dispose();
            term = null;
            fitAddon = null;
        };
    });
</script>

<div
    class="gcp-terminal-wrapper"
    data-audit-id="terminal-surface"
    data-audit-opaque
    data-audit-clip
    data-audit-column
>
    {#if interactive}
        <div class="gcp-terminal-softkeys" data-audit-row="center">
            <button type="button" class="gcp-softkey" onclick={() => sendKey("\x1b")}>Esc</button>
            <button type="button" class="gcp-softkey" onclick={() => sendKey("\t")}>Tab</button>
            <button
                type="button"
                class="gcp-softkey"
                class:active={ctrlActive}
                onclick={() => (ctrlActive = !ctrlActive)}
            >
                Ctrl
            </button>
            <button type="button" class="gcp-softkey" onclick={() => sendKey("\x1b[A")}>↑</button>
            <button type="button" class="gcp-softkey" onclick={() => sendKey("\x1b[B")}>↓</button>
            <button type="button" class="gcp-softkey" onclick={() => sendKey("\x1b[D")}>←</button>
            <button type="button" class="gcp-softkey" onclick={() => sendKey("\x1b[C")}>→</button>
        </div>
    {/if}

    <div
        bind:this={container}
        class="gcp-terminal-surface"
        data-audit-id="terminal-surface"
        data-audit-opaque
        data-audit-clip
    ></div>
</div>

<style>
    .gcp-terminal-wrapper {
        display: flex;
        flex-direction: column;
        width: 100%;
        border: none;
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        overflow: hidden;
    }

    .gcp-terminal-softkeys {
        display: flex;
        gap: var(--space-2);
        padding: var(--space-2);
        background: var(--m3c-surface-container);
        border-block-end: 1px solid var(--m3c-outline-variant);
        overflow-x: auto;
        white-space: nowrap;
    }

    .gcp-softkey {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        color: var(--m3c-on-surface);
        font-family: "JetBrains Mono", monospace;
        font-size: 12px;
        cursor: pointer;
        flex-shrink: 0;
    }

    .gcp-softkey:hover {
        background: var(--m3c-surface-container-low);
    }

    .gcp-softkey.active {
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
    }

    .gcp-terminal-surface {
        padding: var(--space-2);
        overflow: hidden;
    }

    .gcp-terminal-surface :global(.xterm) {
        padding: 0;
    }

    .gcp-terminal-surface :global(.xterm-viewport) {
        overflow-y: auto;
    }
</style>
