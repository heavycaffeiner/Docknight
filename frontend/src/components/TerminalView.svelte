<script lang="ts">
    import { FitAddon } from "@xterm/addon-fit";
    import { WebLinksAddon } from "@xterm/addon-web-links";
    import { Terminal } from "@xterm/xterm";
    import "@xterm/xterm/css/xterm.css";
    import { Button } from "m3-svelte";
    import { connection, on, request } from "../lib/connection.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { theme } from "../lib/stores/theme.svelte.ts";
    import Icon from "./Icon.svelte";

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
    let view = $state<Terminal | null>(null);
    let fit: FitAddon | null = null;

    /** Sticky rather than held: a touch keyboard has no way to keep a modifier down. */
    let ctrl = $state(false);

    /* Reflow is the readable choice where the pane is narrower than a command line, and the wrong
       one on a wide screen, where rewrapping compose output breaks its columns. */
    let wrapped = $state(!interactive && window.matchMedia("(width < 600px)").matches);

    /* An interactive pane hands the pty the real column count instead of scrolling a fixed eighty,
       because the shell wraps its own line and a phone cannot scroll to the caret. */
    const reflow = $derived(interactive || wrapped);

    type ArrowIcon = "arrow-up" | "arrow-down" | "arrow-left" | "arrow-right";

    interface SoftKey {
        id: string;
        label: string;
        data: string;
        icon?: ArrowIcon;
    }

    const ESC = String.fromCodePoint(0x1b);

    const KEYS: SoftKey[] = $derived([
        { id: "esc", label: t("terminalKeyEsc"), data: ESC },
        { id: "tab", label: t("terminalKeyTab"), data: "\t" },
        { id: "interrupt", label: t("terminalKeyInterrupt"), data: String.fromCodePoint(0x03) },
        { id: "left", label: t("terminalKeyLeft"), data: `${ESC}[D`, icon: "arrow-left" },
        { id: "down", label: t("terminalKeyDown"), data: `${ESC}[B`, icon: "arrow-down" },
        { id: "up", label: t("terminalKeyUp"), data: `${ESC}[A`, icon: "arrow-up" },
        { id: "right", label: t("terminalKeyRight"), data: `${ESC}[C`, icon: "arrow-right" },
    ]);

    function send(data: string): void {
        void request(endpoint, "terminal.input", { terminal, data }).catch(() => undefined);
    }

    /** The C0 code Ctrl and a character produce, or null where the pairing makes none. */
    function controlCode(data: string): string | null {
        if ([...data].length !== 1) return null;
        if (data === "?") return String.fromCodePoint(0x7f);
        const code = data.toUpperCase().codePointAt(0) ?? 0;
        return code >= 0x40 && code <= 0x5f ? String.fromCodePoint(code - 0x40) : null;
    }

    function press(key: SoftKey): void {
        ctrl = false;
        send(key.data);
        view?.focus();
    }

    function toggleCtrl(): void {
        ctrl = !ctrl;
        view?.focus();
    }

    function toLatest(): void {
        view?.scrollToBottom();
    }

    /**
     * xterm paints its screen over its own scroller, so a drag lands on the screen and nothing
     * moves: the wheel is the only thing it listens for, and a phone has none. The gesture drives
     * the scroller directly, and the page keeps the drag once the pane has nowhere left to go, so
     * a reader is never held inside a pane they have finished with.
     */
    function dragToScroll(surface: HTMLElement): () => void {
        const viewport = surface.querySelector<HTMLElement>(".xterm-viewport");
        if (viewport === null) return () => undefined;

        let last: number | null = null;

        const begin = (event: TouchEvent): void => {
            last = event.touches[0]?.clientY ?? null;
        };

        const drag = (event: TouchEvent): void => {
            const y = event.touches[0]?.clientY;
            if (last === null || y === undefined) return;
            const before = viewport.scrollTop;
            viewport.scrollTop = before + (last - y);
            if (viewport.scrollTop !== before) event.preventDefault();
            last = y;
        };

        const end = (): void => {
            last = null;
        };

        surface.addEventListener("touchstart", begin, { passive: true });
        surface.addEventListener("touchmove", drag, { passive: false });
        surface.addEventListener("touchend", end, { passive: true });
        surface.addEventListener("touchcancel", end, { passive: true });

        return () => {
            surface.removeEventListener("touchstart", begin);
            surface.removeEventListener("touchmove", drag);
            surface.removeEventListener("touchend", end);
            surface.removeEventListener("touchcancel", end);
        };
    }

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

    $effect(() => {
        if (host === null) return undefined;

        const created = new Terminal({
            rows,
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
        // Fit before the first paint. Left to the resize observer, the pane paints at xterm's own
        // default width and then reflows, which rewraps every line already on screen.
        try {
            fit.fit();
        } catch {
            // A pane opened at zero size fits on the observer's first tick instead.
        }
        view = created;
        const releaseDrag = dragToScroll(host);

        return () => {
            releaseDrag();
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
                if (ctrl) {
                    ctrl = false;
                    const code = controlCode(data);
                    if (code !== null) {
                        send(code);
                        return;
                    }
                }
                send(data);
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
    <div class="scroll">
        <div
            class="surface"
            class:reflow
            class:interactive
            style:--_terminal-rows={rows}
            bind:this={host}
            role="group"
            aria-label={label ?? t("terminalLabel")}
            aria-describedby="terminal-help-{terminal}"
            data-audit-id="terminal-surface"
        ></div>
    </div>
    <p id="terminal-help-{terminal}" class="visually-hidden">{t("terminalDescription")}</p>

    {#if interactive}
        <div class="keys soft" role="group" aria-label={t("terminalKeysLabel")}>
            <Button
                variant={ctrl ? "filled" : "tonal"}
                iconType={ctrl ? "left" : "none"}
                aria-pressed={ctrl}
                aria-describedby="terminal-ctrl-help-{terminal}"
                onclick={toggleCtrl}
            >
                {#if ctrl}<Icon name="check" size="sm" />{/if}
                {t("terminalKeyCtrl")}
            </Button>
            <p id="terminal-ctrl-help-{terminal}" class="visually-hidden">
                {t("terminalKeyCtrlHint")}
            </p>
            {#each KEYS as key (key.id)}
                {#if key.icon === undefined}
                    <Button variant="tonal" onclick={() => press(key)}>{key.label}</Button>
                {:else}
                    <Button
                        variant="tonal"
                        square
                        iconType="full"
                        aria-label={key.label}
                        onclick={() => press(key)}
                    >
                        <Icon name={key.icon} size="md" />
                    </Button>
                {/if}
            {/each}
        </div>
    {:else}
        <div class="keys">
            <Button
                variant={wrapped ? "filled" : "tonal"}
                iconType={wrapped ? "left" : "none"}
                aria-pressed={wrapped}
                onclick={() => (wrapped = !wrapped)}
            >
                {#if wrapped}<Icon name="check" size="sm" />{/if}
                {t("terminalWrap")}
            </Button>
            <Button variant="tonal" iconType="left" onclick={toLatest}>
                <Icon name="down" size="md" />
                {t("terminalLatest")}
            </Button>
        </div>
    {/if}

    {#if exited}
        <p class="exit type-label">exit {exitCode ?? 0}</p>
    {/if}
</div>

<style>
    .wrap {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    /*
     * Command output is preformatted, so a pane that is not reflowing must scroll it rather than
     * rewrap it: at thirty columns every compose line breaks three ways and stops being readable.
     */
    .scroll {
        min-inline-size: 0;
        overflow-x: auto;
        border-radius: var(--radius-md);
    }

    /*
     * The pane is a fixed number of allotted rows, so its box lands on the grid; the fit addon then
     * packs as many character cells as the font metrics allow into that box, and the leftover sliver
     * is clipped. The cells are the second documented exception to the grid, the box is not.
     */
    .surface {
        min-inline-size: var(--measure-terminal);
        block-size: calc(var(--_terminal-rows) * var(--size-terminal-line) + 2 * var(--space-3));
        padding: var(--space-3);
        border-radius: var(--radius-md);
        background-color: rgb(var(--m3-scheme-surface-container-lowest));
        overflow: hidden;
    }

    /* Giving up the eighty column floor hands the pty the pane's real width, so the wrapping is done
       by whatever is writing rather than by a scrollbar the reader has to drag. */
    .surface.reflow {
        min-inline-size: 0;
    }

    .keys {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
    }

    /* A terminal keyboard reads left to right whichever way the page runs, and the arrow glyphs are
       not mirrored, so flipping the row would put the wrong key under the wrong finger. */
    .keys.soft {
        direction: ltr;
    }

    /* A phone gives up more of its height to a pane than it can spare, so a pane asking for forty
       rows is allotted fourteen and scrolls the rest. Ten, which this was, is a window too small to
       follow a log through. */
    @media (height < 600px), (width < 600px) {
        .surface {
            block-size: calc(
                min(var(--_terminal-rows), 14) * var(--size-terminal-line) + 2 * var(--space-3)
            );
        }
    }

    .exit {
        margin: 0;
        color: rgb(var(--m3-scheme-on-surface-variant));
    }
</style>
