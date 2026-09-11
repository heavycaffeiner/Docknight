import { useQuery } from "@tanstack/react-query";
import { type ReactElement, type ReactNode, useRef, useState } from "react";
import { elementValue, useElementEvent } from "../lib/dom-events.ts";
import { useT } from "../lib/i18n.ts";
import { qk } from "../lib/query.ts";
import { useSizeClass } from "../lib/media.ts";
import { linkHandler, navigate, useRoute } from "../lib/router.ts";
import { logout, session } from "../lib/session.ts";
import { useStore } from "../lib/store.ts";
import { request } from "../lib/transport.ts";
import ConnectionBanner from "./ConnectionBanner.tsx";
import StackList from "./StackList.tsx";

interface Destination {
    path: string;
    label: string;
    icon: string;
    activeIcon: string;
}

/** The active destination for a path, so a stack page still lights up Home. */
function activeDestination(path: string, destinations: Destination[]): string {
    if (path === "/" || path.startsWith("/compose")) return "/";
    const match = destinations.find((d) => d.path !== "/" && path.startsWith(d.path));
    return match?.path ?? "/";
}

export default function AppShell({ children }: { children: ReactNode }): ReactElement {
    const { t } = useT();
    const sizeClass = useSizeClass();
    const { path } = useRoute();
    const { username } = useStore(session);
    // The drawer is open for one path only, so any navigation closes it without an effect
    // mirroring the route into a boolean.
    const [drawerPath, setDrawerPath] = useState<string | null>(null);
    const drawerOpen = drawerPath === path;
    const closeDrawer = (): void => setDrawerPath(null);

    const consoleQuery = useQuery({
        queryKey: qk.consoleEnabled(),
        queryFn: () => request<{ enabled?: boolean }>("", "terminal.mainEnabled", undefined),
        staleTime: Infinity,
    });
    const consoleEnabled = consoleQuery.data?.enabled === true;

    const destinations: Destination[] = [
        { path: "/", label: t("nav.home"), icon: "home--outlined", activeIcon: "home" },
        {
            path: "/resources",
            label: t("nav.resources"),
            icon: "widgets--outlined",
            activeIcon: "widgets",
        },
        ...(consoleEnabled
            ? [
                  {
                      path: "/console",
                      label: t("nav.console"),
                      icon: "terminal--outlined",
                      activeIcon: "terminal",
                  },
              ]
            : []),
        {
            path: "/settings",
            label: t("nav.settings"),
            icon: "settings--outlined",
            activeIcon: "settings",
        },
    ];

    const active = activeDestination(path, destinations);
    // Expanded docks the stack list beside the content; narrower widths reach it through the
    // modal drawer, so it is never unreachable the way a width-gated panel would be.
    const drawerIsModal = sizeClass !== "expanded";
    const railRef = useRef<HTMLElement>(null);
    const barRef = useRef<HTMLElement>(null);
    const drawerRef = useRef<HTMLElement>(null);

    // Compare against the destination the current path resolves to, not the path itself: a
    // stack page resolves to Home, and comparing raw paths would read mdui's own change event
    // for the programmatic selection as a user tap and bounce the page back to Home.
    useElementEvent(railRef, "change", () => {
        const value = elementValue(railRef);
        if (value !== "" && value !== active) void navigate(value);
    });
    useElementEvent(barRef, "change", () => {
        const value = elementValue(barRef);
        if (value !== "" && value !== active) void navigate(value);
    });
    useElementEvent(drawerRef, "close", closeDrawer);

    return (
        <mdui-layout full-height>
            <mdui-top-app-bar>
                {drawerIsModal ? (
                    <mdui-button-icon
                        icon="menu"
                        aria-label={t("nav.openDrawer")}
                        onClick={() => setDrawerPath(path)}
                    />
                ) : null}
                <mdui-top-app-bar-title>
                    <a href="/" onClick={linkHandler("/")} className="brand">
                        <span className="brand__mark" aria-hidden="true">
                            <mdui-icon name="inventory_2--outlined" />
                        </span>
                        <span>Docknight</span>
                    </a>
                </mdui-top-app-bar-title>
                <div className="spacer" />
                <mdui-dropdown placement="bottom-end">
                    {sizeClass === "expanded" ? (
                        <mdui-button
                            slot="trigger"
                            variant="text"
                            aria-label={username ?? "account"}
                        >
                            {username}
                        </mdui-button>
                    ) : (
                        <mdui-button-icon
                            slot="trigger"
                            icon="account_circle--outlined"
                            aria-label={username ?? "account"}
                        />
                    )}
                    <mdui-menu>
                        {username !== null ? <mdui-menu-item disabled>{username}</mdui-menu-item> : null}
                        <mdui-menu-item
                            onClick={() => {
                                void logout().then(() => navigate("/"));
                            }}
                        >
                            {t("settings.security.logout")}
                        </mdui-menu-item>
                    </mdui-menu>
                </mdui-dropdown>
            </mdui-top-app-bar>

            {sizeClass !== "compact" ? (
                <mdui-navigation-rail ref={railRef} value={active} divider>
                    {destinations.map((d) => (
                        <mdui-navigation-rail-item
                            key={d.path}
                            value={d.path}
                            icon={d.icon}
                            active-icon={d.activeIcon}
                        >
                            {d.label}
                        </mdui-navigation-rail-item>
                    ))}
                </mdui-navigation-rail>
            ) : null}

            <mdui-navigation-drawer
                ref={drawerRef}
                className="stack-drawer"
                open={drawerIsModal ? drawerOpen : true}
                modal={drawerIsModal}
                close-on-esc
                close-on-overlay-click
            >
                <StackList onNavigate={closeDrawer} />
            </mdui-navigation-drawer>

            <mdui-layout-main>
                <ConnectionBanner />
                {children}
            </mdui-layout-main>

            {sizeClass === "compact" ? (
                <mdui-navigation-bar ref={barRef} value={active} label-visibility="labeled">
                    {destinations.map((d) => (
                        <mdui-navigation-bar-item
                            key={d.path}
                            value={d.path}
                            icon={d.icon}
                            active-icon={d.activeIcon}
                        >
                            {d.label}
                        </mdui-navigation-bar-item>
                    ))}
                </mdui-navigation-bar>
            ) : null}
        </mdui-layout>
    );
}
