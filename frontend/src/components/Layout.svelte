<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
    import type { Snippet } from "svelte";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { session, logout } from "../lib/stores/session.svelte.ts";
    import { keyboardOpen } from "../lib/viewport.svelte.ts";
    import { route, navigate } from "../router.svelte.ts";
    import { request } from "../lib/connection.svelte.ts";
    import StackList from "./StackList.svelte";
    import MenuButton, { type MenuItemSpec } from "./MenuButton.svelte";
    import ConnectionBanner from "./ConnectionBanner.svelte";

    interface Props {
        children: Snippet;
    }

    let { children }: Props = $props();

    const isMedium = new MediaQuery("width >= 600px");
    const isExpanded = new MediaQuery("width >= 840px");

    let consoleEnabled = $state(false);

    $effect(() => {
        if (session.state === "authenticated") {
            void request<{ enabled?: boolean }>("", "terminal.mainEnabled", undefined)
                .then((res) => {
                    consoleEnabled = res.enabled === true;
                })
                .catch(() => {
                    consoleEnabled = false;
                });
        }
    });

    const destinations = $derived.by(() => {
        const list = [
            { path: "/", label: t("nav.home"), icon: "home" },
        ];
        if (consoleEnabled) {
            list.push({ path: "/console", label: t("nav.console"), icon: "terminal" });
        }
        list.push({ path: "/settings/general", label: t("nav.settings"), icon: "settings" });
        return list;
    });

    function isActive(path: string): boolean {
        if (path === "/") {
            return route.path === "/" || route.path.startsWith("/compose");
        }
        return route.path.startsWith(path);
    }

    const accountMenuItems = $derived.by((): MenuItemSpec[] => [
        {
            label: t("settings.security.logout"),
            danger: true,
            onSelect: () => {
                void logout().then(() => void navigate("/"));
            },
        },
    ]);
</script>

<div class="gcp-shell" data-audit-root data-grid-origin>
    <ConnectionBanner />

    <header class="gcp-header" data-audit-row="center">
        <div class="gcp-header-start" data-audit-row="center">
            <a
                href="/"
                class="gcp-brand"
                data-audit-row="center"
                onclick={(e) => {
                    e.preventDefault();
                    void navigate("/");
                }}
            >
                <svg class="gcp-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
                <span class="text-headline gcp-brand-name">Docknight</span>
            </a>
        </div>

        <div class="gcp-header-end" data-audit-row="center">
            <div class="gcp-user-info" data-audit-row="center">
                {#if session.username}
                    <span class="text-label gcp-user-name">{session.username}</span>
                {/if}
                <MenuButton items={accountMenuItems} label="Account menu" />
            </div>
        </div>
    </header>

    <div class="gcp-body">
        {#if isMedium.current}
            <nav class="gcp-rail" aria-label={t("nav.main")}>
                {#each destinations as dest (dest.path)}
                    <a
                        href={dest.path}
                        class="gcp-rail-item"
                        class:active={isActive(dest.path)}
                        onclick={(e) => {
                            e.preventDefault();
                            void navigate(dest.path);
                        }}
                    >
                        <div class="gcp-indicator">
                            {#if dest.icon === "home"}
                                <svg class="gcp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                    <polyline points="9 22 9 12 15 12 15 22"/>
                                </svg>
                            {:else if dest.icon === "terminal"}
                                <svg class="gcp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                                    <polyline points="4 17 10 11 4 5"/>
                                    <line x1="12" y1="19" x2="20" y2="19"/>
                                </svg>
                            {:else}
                                <svg class="gcp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                                    <circle cx="12" cy="12" r="3"/>
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                                </svg>
                            {/if}
                        </div>
                        <span class="gcp-nav-label text-label" data-audit-clip>{dest.label}</span>
                    </a>
                {/each}
            </nav>
        {/if}

        {#if isExpanded.current}
            <aside class="gcp-panel" data-grid-origin data-audit-id="stack-panel">
                <StackList filter="" />
            </aside>
        {/if}

        <main class="gcp-outlet" data-grid-origin>
            {@render children()}
        </main>
    </div>

    {#if !isMedium.current}
        <nav
            class="gcp-bottom-bar"
            class:hidden={keyboardOpen.value}
            aria-label={t("nav.main")}
            data-audit-exempt-grid
        >
            {#each destinations as dest (dest.path)}
                <a
                    href={dest.path}
                    class="gcp-bottom-item"
                    class:active={isActive(dest.path)}
                    data-audit-clip
                    onclick={(e) => {
                        e.preventDefault();
                        void navigate(dest.path);
                    }}
                >
                    <div class="gcp-indicator">
                        {#if dest.icon === "home"}
                            <svg class="gcp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                <polyline points="9 22 9 12 15 12 15 22"/>
                            </svg>
                        {:else if dest.icon === "terminal"}
                            <svg class="gcp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                                <polyline points="4 17 10 11 4 5"/>
                                <line x1="12" y1="19" x2="20" y2="19"/>
                            </svg>
                        {:else}
                            <svg class="gcp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                                <circle cx="12" cy="12" r="3"/>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                            </svg>
                        {/if}
                    </div>
                    <span class="gcp-nav-label text-label" data-audit-clip>{dest.label}</span>
                </a>
            {/each}
        </nav>
    {/if}
</div>

<style>
    .gcp-shell {
        display: flex;
        flex-direction: column;
        block-size: var(--viewport-block, 100dvh);
    }

    .gcp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: var(--size-control-xl);
        padding-inline: var(--space-4);
        background: var(--m3c-surface-container);
        color: var(--m3c-on-surface);
        border-block-end: 1px solid var(--m3c-outline-variant);
        flex-shrink: 0;
        overflow: hidden;
    }

    .gcp-header-start {
        display: flex;
        align-items: center;
        gap: var(--space-3);
    }

    .gcp-brand {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        text-decoration: none;
        color: inherit;
        min-block-size: var(--size-control-md);
    }

    .gcp-logo {
        width: var(--size-icon-lg);
        height: var(--size-icon-lg);
        color: var(--m3c-primary);
    }

    .gcp-brand-name {
        font-weight: 600;
        letter-spacing: -0.5px;
    }

    .gcp-header-end {
        display: flex;
        align-items: center;
        gap: var(--space-3);
    }

    .gcp-user-info {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .gcp-user-name {
        color: var(--m3c-on-surface-variant);
        font-weight: 500;
    }

    .gcp-body {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .gcp-rail {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: var(--size-nav-rail);
        padding-block: var(--space-2);
        background: var(--m3c-surface-container);
        border-inline-end: 1px solid var(--m3c-outline-variant);
        flex-shrink: 0;
        gap: var(--space-2);
    }

    .gcp-rail-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding-block: var(--space-1);
        text-decoration: none;
        color: var(--m3c-on-surface-variant);
        gap: var(--space-1);
    }

    .gcp-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-xl);
        height: var(--size-control-sm);
        border-radius: var(--radius-xl);
    }

    .gcp-rail-item:hover .gcp-indicator,
    .gcp-bottom-item:hover .gcp-indicator {
        background: var(--m3c-surface-container-highest);
    }

    .gcp-rail-item.active .gcp-indicator,
    .gcp-bottom-item.active .gcp-indicator {
        background: var(--m3c-secondary-container);
        color: var(--m3c-on-secondary-container);
    }

    .gcp-nav-label {
        font-size: 11px;
        line-height: var(--size-icon-sm);
        text-align: center;
    }

    .gcp-rail-item.active .gcp-nav-label,
    .gcp-bottom-item.active .gcp-nav-label {
        color: var(--m3c-on-surface);
        font-weight: 700;
    }

    .gcp-nav-icon {
        width: var(--size-icon-md);
        height: var(--size-icon-md);
    }

    .gcp-panel {
        width: var(--measure-panel);
        flex-shrink: 0;
        overflow-y: auto;
        border-inline-end: 1px solid var(--m3c-outline-variant);
        background: var(--m3c-surface-container-low);
        padding: var(--space-3);
    }

    .gcp-outlet {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
        background: var(--m3c-surface);
    }

    .gcp-bottom-bar {
        display: flex;
        align-items: center;
        height: var(--size-bottom-bar);
        background: var(--m3c-surface-container);
        border-block-start: 1px solid var(--m3c-outline-variant);
        flex-shrink: 0;
    }

    .gcp-bottom-bar.hidden {
        display: none;
    }

    .gcp-bottom-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-1);
        flex: 1;
        height: 100%;
        padding-inline: var(--space-1);
        overflow: hidden;
        color: var(--m3c-on-surface-variant);
        text-decoration: none;
    }
</style>
