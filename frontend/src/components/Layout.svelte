<script lang="ts">
    import type { Snippet } from "svelte";
    import { MediaQuery } from "svelte/reactivity";
    import { request } from "../lib/connection.svelte.ts";
    import { keyboardOpen } from "../lib/viewport.svelte.ts";
    import { navigate, route } from "../router.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { session, logout } from "../lib/stores/session.svelte.ts";
    import ConnectionBanner from "./ConnectionBanner.svelte";
    import StackList from "./StackList.svelte";
    import MenuButton from "./MenuButton.svelte";

    interface Props {
        children: Snippet;
    }

    let { children }: Props = $props();

    const isMedium = new MediaQuery("width >= 600px");
    const isExpanded = new MediaQuery("width >= 840px");

    let consoleEnabled = $state(false);

    $effect(() => {
        if (session.state === "authenticated") {
            request("", "terminal.mainEnabled", undefined)
                .then((result) => {
                    consoleEnabled = result.enabled;
                })
                .catch(() => {
                    consoleEnabled = false;
                });
        }
    });

    const destinations = $derived(
        [
            { path: "/", label: t("nav.home") },
            ...(consoleEnabled ? [{ path: "/console", label: t("nav.console") }] : []),
            { path: "/settings/general", label: t("nav.settings") },
        ] as const,
    );

    function isActive(path: string): boolean {
        return route.path === path || (path !== "/" && route.path.startsWith(path));
    }
</script>

<div class="gcp-shell" data-audit-root data-grid-origin>
    <ConnectionBanner />
    <header class="gcp-header" data-audit-row="center">
        <div class="gcp-header-brand" data-audit-row="center">
            <svg class="gcp-app-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
            <span class="text-title gcp-app-name">{t("app.name")}</span>
            <div class="gcp-project-selector" data-audit-row="center" data-audit-clip>
                <span class="gcp-project-dot" aria-hidden="true"></span>
                <span class="gcp-project-name text-label" data-audit-clip>default</span>
                <svg class="gcp-chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
            </div>
        </div>
        <div class="gcp-header-search" data-audit-row="center">
            <svg class="gcp-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <span class="gcp-search-placeholder text-label" data-audit-clip>{t("stack.list.search")}</span>
            <kbd class="gcp-search-kbd">/</kbd>
        </div>
        <div class="gcp-header-actions" data-audit-row="center">
            {#if consoleEnabled}
                <a
                    href="/console"
                    class="gcp-header-icon-btn"
                    aria-label={t("nav.console")}
                    onclick={(e) => {
                        e.preventDefault();
                        void navigate("/console");
                    }}
                >
                    <svg class="gcp-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                        <polyline points="4 17 10 11 4 5"/>
                        <line x1="12" y1="19" x2="20" y2="19"/>
                    </svg>
                </a>
            {/if}
            <a
                href="/compose"
                class="gcp-header-create-btn"
                aria-label={t("stack.list.createFirst")}
                onclick={(e) => {
                    e.preventDefault();
                    void navigate("/compose");
                }}
            >
                <svg class="gcp-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                <span class="create-label text-label">{t("stack.list.createFirst")}</span>
            </a>
            <MenuButton
                label={t("action.more")}
                items={[{ label: t("settings.security.logout"), onSelect: () => void logout() }]}
            />
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
                        data-audit-clip
                        onclick={(e) => {
                            e.preventDefault();
                            void navigate(dest.path);
                        }}
                    >
                        <div class="gcp-indicator">
                            {#if dest.path === "/"}
                                <svg class="gcp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                    <polyline points="9 22 9 12 15 12 15 22"/>
                                </svg>
                            {:else if dest.path.startsWith("/console")}
                                <svg class="gcp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                                    <polyline points="4 17 10 11 4 5"/>
                                    <line x1="12" y1="19" x2="20" y2="19"/>
                                </svg>
                            {:else}
                                <svg class="gcp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                                    <circle cx="12" cy="12" r="3"/>
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51-1z"/>
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
                        {#if dest.path === "/"}
                            <svg class="gcp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                <polyline points="9 22 9 12 15 12 15 22"/>
                            </svg>
                        {:else if dest.path.startsWith("/console")}
                            <svg class="gcp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                                <polyline points="4 17 10 11 4 5"/>
                                <line x1="12" y1="19" x2="20" y2="19"/>
                            </svg>
                        {:else}
                            <svg class="gcp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                                <circle cx="12" cy="12" r="3"/>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51-1z"/>
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

    @media (width < 600px) {
        .gcp-header {
            padding-inline: var(--space-2);
        }
    }

    .gcp-header-brand {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-shrink: 0;
    }

    .gcp-app-logo {
        width: var(--size-icon-lg);
        height: var(--size-icon-lg);
        color: var(--m3c-primary);
        flex-shrink: 0;
    }

    .gcp-app-name {
        font-weight: 700;
        letter-spacing: -0.02em;
        white-space: nowrap;
    }

    .gcp-project-selector {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        height: var(--size-control-sm);
        padding-inline: var(--space-2);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-high);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        color: var(--m3c-on-surface);
        font-size: 11px;
        font-weight: 600;
    }

    .gcp-project-dot {
        width: var(--space-2);
        height: var(--space-2);
        border-radius: 50%;
        background: var(--m3c-tertiary);
        flex-shrink: 0;
    }

    .gcp-project-name {
        color: var(--m3c-on-surface);
    }

    .gcp-chevron-icon {
        width: var(--size-icon-sm);
        height: var(--size-icon-sm);
        color: var(--m3c-on-surface-variant);
    }

    @media (width < 840px) {
        .gcp-project-selector {
            display: none;
        }
    }

    .gcp-header-search {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
        max-width: var(--measure-form);
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border-radius: var(--radius-sm);
        background: var(--m3c-surface-container-high);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        color: var(--m3c-on-surface-variant);
        cursor: text;
    }

    .gcp-search-icon {
        width: var(--size-icon-sm);
        height: var(--size-icon-sm);
        color: var(--m3c-on-surface-variant);
        flex-shrink: 0;
    }

    .gcp-search-placeholder {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--m3c-on-surface-variant);
        font-size: 13px;
    }

    .gcp-search-kbd {
        padding-inline: var(--space-1);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-highest);
        color: var(--m3c-on-surface-variant);
        font: 11px ui-monospace, monospace;
        line-height: var(--space-3);
    }

    @media (width < 840px) {
        .gcp-header-search {
            display: none;
        }
    }

    .gcp-header-actions {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-shrink: 0;
    }

    .gcp-header-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-md);
        height: var(--size-control-md);
        border-radius: var(--radius-xl);
        background: var(--m3c-surface-container-high);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        color: var(--m3c-on-surface);
        text-decoration: none;
    }

    .gcp-header-icon-btn:hover {
        background: var(--m3c-surface-container-highest);
    }

    .gcp-header-create-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border-radius: var(--radius-xl);
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        text-decoration: none;
        font-weight: 600;
        font-size: 13px;
    }

    .gcp-header-create-btn:hover {
        background: var(--m3c-primary-dim);
    }

    @media (width < 600px) {
        .gcp-header-icon-btn {
            display: none;
        }

        .create-label {
            display: none;
        }

        .gcp-header-create-btn {
            width: var(--size-control-md);
            height: var(--size-control-md);
            padding-inline: 0;
            justify-content: center;
        }
    }

    .gcp-btn-icon {
        width: var(--size-icon-sm);
        height: var(--size-icon-sm);
        flex-shrink: 0;
    }

    .gcp-body {
        display: flex;
        flex: 1;
        min-height: 0;
    }

    .gcp-rail {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-3);
        width: var(--size-nav-rail);
        padding-block: var(--space-3);
        background: var(--m3c-surface-container-low);
        border-inline-end: 1px solid var(--m3c-outline-variant);
        flex-shrink: 0;
    }

    :global([data-keyboard="open"]) .gcp-rail {
        display: none;
    }

    .gcp-rail-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-1);
        width: 100%;
        height: var(--size-control-xl);
        padding-inline: var(--space-1);
        overflow: hidden;
        color: var(--m3c-on-surface-variant);
        text-decoration: none;
        border-radius: var(--radius-sm);
    }

    .gcp-rail-item:hover {
        background: var(--m3c-surface-container-high);
    }

    .gcp-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-xl);
        height: var(--size-control-sm);
        border-radius: var(--radius-xl);
    }

    .gcp-nav-icon {
        width: var(--size-icon-md);
        height: var(--size-icon-md);
    }

    .gcp-nav-label {
        font-size: 11px;
        line-height: var(--space-3);
        font-weight: 500;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
        max-width: 100%;
    }

    .gcp-rail-item.active .gcp-indicator,
    .gcp-bottom-item.active .gcp-indicator {
        background: var(--m3c-secondary-container);
        color: var(--m3c-on-secondary-container);
    }

    .gcp-rail-item.active .gcp-nav-label,
    .gcp-bottom-item.active .gcp-nav-label {
        color: var(--m3c-on-surface);
        font-weight: 700;
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
