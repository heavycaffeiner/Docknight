// The text face is pinned rather than left to system-ui, so a screenshot taken on any host is the
// same picture. Hangul comes from the Korean subset alone: the full Noto Sans KR file carries Latin
// too and would win the cascade for it, at half a megabyte per weight.
import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/700.css";
import "@fontsource/noto-sans-kr/korean-400.css";
import "@fontsource/noto-sans-kr/korean-500.css";
import "@fontsource/noto-sans-kr/korean-700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "m3-svelte/misc/styles.css";
import "./styles/theme.css";
import "./styles/tokens.css";
import "./styles/global.css";

import { mount } from "svelte";
import App from "./App.svelte";
import { connect, onOpen } from "./lib/connection.svelte.ts";
import { bindServerEvents } from "./lib/events.ts";
import { initLocale } from "./lib/stores/i18n.svelte.ts";
import { resume } from "./lib/stores/session.svelte.ts";
import { loadConsoleEnabled, loadSettings } from "./lib/stores/settings.svelte.ts";
import { initTheme } from "./lib/stores/theme.svelte.ts";
import { startRouter } from "./router.svelte.ts";

initTheme();
await initLocale();

bindServerEvents();

onOpen(async () => {
    // Awaited, so requests that need authentication are held until the session is restored rather
    // than sent into a connection the server still considers anonymous.
    const ok = await resume();
    if (!ok) return;
    // After a successful re-login the stores are refilled from the server's events, so a
    // reconnect cannot render stale rows as live.
    void loadSettings().catch(() => undefined);
    void loadConsoleEnabled();
});

connect();
startRouter();

const target = document.getElementById("app");
if (target === null) throw new Error("the #app mount point is missing from index.html");


mount(App, { target });

// Development only: Ctrl+Shift+G draws the 4 pixel rule, Ctrl+Shift+A runs the layout auditor.
if (import.meta.env.DEV) {
    const { default: Overlay } = await import("../../tools/overlay/Overlay.svelte");
    const overlayHost = document.createElement("div");
    document.body.append(overlayHost);
    mount(Overlay, { target: overlayHost });
}
