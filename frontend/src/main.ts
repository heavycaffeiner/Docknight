import { mount } from "svelte";
import "./styles/tokens.css";
import "./styles/theme.css";
import "./styles/global.css";
import { themeInit } from "./lib/stores/theme.svelte.ts";
import App from "./App.svelte";

themeInit();

const target = document.getElementById("app");
if (target !== null) {
    mount(App, { target });
}

if (import.meta.env.DEV) {
    void import("../../tools/overlay/overlay.svelte").then((mod) => {
        const overlayTarget = document.createElement("div");
        document.body.appendChild(overlayTarget);
        mount(mod.default, { target: overlayTarget });
    });
}
