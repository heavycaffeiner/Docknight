import { type ReactElement, Suspense, useEffect } from "react";
import AppShell from "./components/AppShell.tsx";
import PageFallback from "./components/PageFallback.tsx";
import { i18nInit, useT } from "./lib/i18n.ts";
import { queryInvalidationInit } from "./lib/query.ts";
import { route, routerInit, setupNeeded } from "./lib/router.ts";
import { resume, session } from "./lib/session.ts";
import { useStore } from "./lib/store.ts";
import { connection, on, transportInit } from "./lib/transport.ts";
import { trackViewport } from "./lib/viewport.ts";
import Login from "./pages/Login.tsx";
import Setup from "./pages/Setup.tsx";
import { resolveRoute } from "./routes.ts";

export default function App(): ReactElement {
    const { t } = useT();
    const { phase, generation } = useStore(connection);
    const { state: sessionState } = useStore(session);
    const needsSetup = useStore(setupNeeded);
    const { path } = useStore(route);
    // The socket bumps `generation` on every successful open, so a non-zero value is the
    // record of having connected at least once. No mirrored state, no effect.
    const everConnected = generation > 0;

    useEffect(() => {
        const stopViewport = trackViewport();
        const stopRouter = routerInit();
        queryInvalidationInit();
        transportInit();
        void i18nInit();

        const offSetup = on("setup", () => setupNeeded.set(true));
        const offRefresh = on("refresh", () => location.reload());

        void resume();

        return () => {
            stopViewport();
            stopRouter();
            offSetup();
            offRefresh();
        };
    }, []);

    if (!everConnected && phase !== "disconnected") {
        return (
            <div className="center-screen type-body-medium">
                <mdui-circular-progress />
                <span>{t("app.starting")}</span>
            </div>
        );
    }

    if (needsSetup) return <Setup />;
    if (sessionState !== "authenticated") return <Login />;

    const { Component } = resolveRoute(path);

    return (
        <AppShell>
            <Suspense fallback={<PageFallback />}>
                <Component />
            </Suspense>
        </AppShell>
    );
}
