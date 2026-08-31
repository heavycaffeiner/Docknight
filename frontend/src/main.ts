import { mount } from "svelte";
import App from "./App.svelte";
import "./lib/stores/theme.svelte.ts";
import "./styles/tokens.css";
import "./styles/theme.css";
import "./styles/global.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";

const target = document.getElementById("app");
if (target === null) throw new Error("no #app element in index.html");

mount(App, { target });

if (import.meta.env.DEV) {
    // Dynamic import keeps the grid and audit overlay, and the auditor it pulls in, entirely
    // out of the production bundle; Ctrl+Shift+G and Ctrl+Shift+A do nothing outside a dev build.
    void import("../../tools/overlay/overlay.svelte").then((mod) => {
        const overlayTarget = document.createElement("div");
        document.body.appendChild(overlayTarget);
        mount(mod.default, { target: overlayTarget });
    });
}
