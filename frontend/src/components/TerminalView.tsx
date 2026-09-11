import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ITheme } from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { useT } from "../lib/i18n.ts";
import { resolvedTheme, themePreference } from "../lib/theme.ts";
import { on, request } from "../lib/transport.ts";
import "./TerminalView.css";

interface Props {
    endpoint?: string;
    terminal: string;
    interactive?: boolean;
    rows?: number;
}

/**
 * Fallback palettes, used both when a token is momentarily unreadable (mount before the first
 * paint) and for the eight ANSI colors, which mdui has no per-hue tokens for.
 */
const DARK_THEME: ITheme = {
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

const LIGHT_THEME: ITheme = {
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

/** Reads a live mdui color token (`R, G, B`) off the root element and wraps it for CSS. */
function readColorToken(name: string, fallback: string): string {
    if (typeof window === "undefined") return fallback;
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return raw === "" ? fallback : `rgb(${raw})`;
}

/**
 * xterm paints on a canvas, so it cannot read CSS variables itself. This rebuilds its theme
 * from the same mdui tokens the surrounding chrome uses, so the terminal reads as part of the
 * app rather than a foreign embed. The eight ANSI colors are not tokenised by mdui and keep a
 * standard palette selected by resolved light/dark.
 */
function buildTheme(): ITheme {
    const base = resolvedTheme() === "dark" ? DARK_THEME : LIGHT_THEME;
    return {
        ...base,
        background: readColorToken("--mdui-color-surface-container-lowest", base.background ?? "#1e1e1e"),
        foreground: readColorToken("--mdui-color-on-surface", base.foreground ?? "#d4d4d4"),
        cursor: readColorToken("--mdui-color-primary", base.cursor ?? "#ffffff"),
        selectionBackground: readColorToken(
            "--mdui-color-secondary-container",
            base.selectionBackground ?? "#264f78",
        ),
    };
}

/**
 * An xterm.js terminal wired to Docknight's terminal RPCs: join replays the scrollback buffer,
 * `terminalWrite`/`terminalExit` push events keep it live, input only flows back when
 * `interactive`, and a debounced resize observer keeps the pty's geometry matching the
 * container. Leaving (unmount) always tells the server so the session can be reused or reaped.
 */
export default function TerminalView({
    endpoint = "",
    terminal,
    interactive = false,
    rows = 24,
}: Props): ReactElement {
    const { t } = useT();
    const containerRef = useRef<HTMLDivElement>(null);
    const [ctrlActive, setCtrlActive] = useState(false);

    function sendKey(data: string): void {
        if (ctrlActive && data.length === 1) {
            const code = data.toUpperCase().charCodeAt(0);
            if (code >= 65 && code <= 90) {
                const ctrlCode = String.fromCharCode(code - 64);
                void request(endpoint, "terminal.input", { terminal, data: ctrlCode });
                setCtrlActive(false);
                return;
            }
        }
        void request(endpoint, "terminal.input", { terminal, data });
    }

    useEffect(() => {
        const container = containerRef.current;
        if (container === null) return;

        const term = new Terminal({
            theme: buildTheme(),
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 13,
            lineHeight: 20 / 13,
            rows,
            cursorBlink: interactive,
            disableStdin: !interactive,
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.open(container);

        try {
            fitAddon.fit();
        } catch {
            // ignore layout timing
        }

        void request<{ buffer: string; exited: boolean; exitCode: number | null }>(endpoint, "terminal.join", {
            terminal,
        })
            .then((res) => {
                if (res.buffer) term.write(res.buffer);
                if (res.exited) {
                    term.write(`\r\n[Process completed with code ${res.exitCode ?? 0}]\r\n`);
                }
            })
            .catch(() => {});

        const unsubWrite = on("terminalWrite", (payload, evEndpoint) => {
            const data = payload as { terminal?: string; data?: string } | undefined;
            if (data?.terminal === terminal && evEndpoint === endpoint && data.data) {
                term.write(data.data);
            }
        });

        const unsubExit = on("terminalExit", (payload, evEndpoint) => {
            const data = payload as { terminal?: string; exitCode?: number } | undefined;
            if (data?.terminal === terminal && evEndpoint === endpoint) {
                term.write(`\r\n[Process completed with code ${data.exitCode ?? 0}]\r\n`);
            }
        });

        const onData = interactive
            ? term.onData((data) => {
                  void request(endpoint, "terminal.input", { terminal, data });
              })
            : null;

        let resizeTimer: number | undefined;
        const ro = new ResizeObserver(() => {
            clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => {
                try {
                    fitAddon.fit();
                    void request(endpoint, "terminal.resize", { terminal, cols: term.cols, rows: term.rows });
                } catch {
                    // ignore unmounted fits
                }
            }, 100);
        });
        ro.observe(container);

        const unsubTheme = themePreference.subscribe(() => {
            term.options.theme = buildTheme();
        });

        return () => {
            clearTimeout(resizeTimer);
            unsubWrite();
            unsubExit();
            unsubTheme();
            onData?.dispose();
            ro.disconnect();
            void request(endpoint, "terminal.leave", { terminal }).catch(() => {});
            term.dispose();
        };
    }, [endpoint, terminal, interactive, rows]);

    return (
        <div className="terminal-wrapper">
            {interactive ? (
                <div className="terminal-softkeys">
                    <button type="button" className="softkey" onClick={() => sendKey("\x1b")}>
                        Esc
                    </button>
                    <button type="button" className="softkey" onClick={() => sendKey("\t")}>
                        Tab
                    </button>
                    <button
                        type="button"
                        className={ctrlActive ? "softkey softkey--active" : "softkey"}
                        onClick={() => setCtrlActive((v) => !v)}
                    >
                        Ctrl
                    </button>
                    <button type="button" className="softkey" onClick={() => sendKey("\x1b[A")}>
                        ↑
                    </button>
                    <button type="button" className="softkey" onClick={() => sendKey("\x1b[B")}>
                        ↓
                    </button>
                    <button type="button" className="softkey" onClick={() => sendKey("\x1b[D")}>
                        ←
                    </button>
                    <button type="button" className="softkey" onClick={() => sendKey("\x1b[C")}>
                        →
                    </button>
                </div>
            ) : null}

            <div ref={containerRef} className="terminal-surface" role="region" aria-label={t("terminal.output")} />
        </div>
    );
}
