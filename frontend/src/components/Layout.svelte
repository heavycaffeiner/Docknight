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

<div class="shell" data-audit-root data-grid-origin>
    <ConnectionBanner />
    <header class="header" data-audit-row="center">
        <span class="text-title app-name">{t("app.name")}</span>
        <div class="header-actions">
            <MenuButton
                label={t("action.more")}
                items={[{ label: t("settings.security.logout"), onSelect: () => void logout() }]}
            />
        </div>
    </header>

    <div class="body">
        {#if isMedium.current}
            <nav class="rail" aria-label={t("nav.main")}>
                {#each destinations as dest (dest.path)}
                    <a
                        href={dest.path}
                        class="rail-item"
                        class:active={isActive(dest.path)}
                        data-audit-clip
                        onclick={(e) => { e.preventDefault(); void navigate(dest.path); }}
                    >
                        {dest.label}
                    </a>
                {/each}
            </nav>
        {/if}

        {#if isExpanded.current}
            <aside class="panel" data-grid-origin data-audit-id="stack-panel">
                <StackList filter="" />
            </aside>
        {/if}

        <main class="outlet" data-grid-origin>
            {@render children()}
        </main>
    </div>

    {#if !isMedium.current}
        <nav
            class="bottom-bar"
            class:hidden={keyboardOpen.value}
            aria-label={t("nav.main")}
            data-audit-exempt-grid
        >
            {#each destinations as dest (dest.path)}
                <a
                    href={dest.path}
                    class="bottom-item"
                    class:active={isActive(dest.path)}
                    data-audit-clip
                    onclick={(e) => { e.preventDefault(); void navigate(dest.path); }}
                >
                    {dest.label}
                </a>
            {/each}
        </nav>
    {/if}
</div>

<style>
    .shell {
        display: flex;
        flex-direction: column;
        block-size: var(--viewport-block, 100dvh);
    }

    .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: var(--size-control-xl);
        padding-inline: var(--space-4);
        background: var(--m3c-surface-container);
        color: var(--m3c-on-surface);
        flex-shrink: 0;
    }

    .app-name {
        font-weight: 600;
    }

    .body {
        display: flex;
        flex: 1;
        min-height: 0;
    }

    .rail {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-2);
        width: var(--size-nav-rail);
        padding-block-start: var(--space-4);
        background: var(--m3c-surface-container-low);
        flex-shrink: 0;
    }

    /*
     * The bottom bar carries navigation and is hidden while the keyboard is open; the bottom
     * app bar on a detail screen (proposal 6 section 4.3.9) is a different element and stays.
     */
    :global([data-keyboard="open"]) .rail {
        display: none;
    }

    .rail-item {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: var(--size-control-xl);
        padding-inline: var(--space-1);
        overflow: hidden;
        color: var(--m3c-on-surface-variant);
        text-decoration: none;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
    }

    .rail-item.active {
        color: var(--m3c-primary);
        font-weight: 600;
    }

    .panel {
        width: var(--measure-panel);
        flex-shrink: 0;
        overflow-y: auto;
        border-inline-end: 1px solid var(--m3c-outline-variant);
        padding: var(--space-4);
    }

    .outlet {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
    }

    .bottom-bar {
        display: flex;
        height: var(--size-bottom-bar);
        background: var(--m3c-surface-container-low);
        flex-shrink: 0;
    }

    .bottom-bar.hidden {
        display: none;
    }

    .bottom-item {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        padding-inline: var(--space-1);
        overflow: hidden;
        color: var(--m3c-on-surface-variant);
        text-decoration: none;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
    }

    .bottom-item.active {
        color: var(--m3c-primary);
        font-weight: 600;
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }
</style>
