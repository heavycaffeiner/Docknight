import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { mduiA11yInit } from "./lib/mdui-a11y.ts";
import { queryClient } from "./lib/query.ts";
import { themeInit } from "./lib/theme.ts";
import "./mdui.ts";
import "./styles/app.css";

themeInit();
mduiA11yInit();

const container = document.getElementById("app");
if (container !== null) {
    createRoot(container).render(
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                <App />
            </QueryClientProvider>
        </StrictMode>,
    );
}
