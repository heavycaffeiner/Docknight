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
