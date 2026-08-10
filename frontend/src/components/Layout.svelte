<script lang="ts">
    import type { Component } from "svelte";
    import { Button } from "m3-svelte";
    import ConnectionBanner from "./ConnectionBanner.svelte";
    import Icon from "./Icon.svelte";
    import StackList from "./StackList.svelte";
    import { announce, focusHeading } from "../lib/a11y.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { logout, session } from "../lib/stores/session.svelte.ts";
    import { consoleEnabled } from "../lib/stores/settings.svelte.ts";
    import { toastError } from "../lib/stores/toast.svelte.ts";
    import { navigate, route } from "../router.svelte.ts";

    interface Props {
        component: Component<Record<string, never>> | null;
        notFound: boolean;
    }

    const { component, notFound }: Props = $props();

    let outlet = $state<HTMLElement | null>(null);
    let search = $state("");
    let accountOpen = $state(false);

    /** The stack list is the whole of the home route on compact widths. */
    const isHome = $derived(route.path === "/");

    const destinations = $derived.by(() => {
        const items = [
            { path: "/", icon: "home" as const, key: "navHome" },
            ...(consoleEnabled.value ? [{ path: "/console", icon: "terminal" as const, key: "navConsole" }] : []),
            { path: "/settings/general", icon: "settings" as const, key: "navSettings" },
        ];
        return items;
    });

    function isActive(path: string): boolean {
        if (path === "/") return route.path === "/";
        return route.path.startsWith(path.split("/").slice(0, 2).join("/"));
    }

    // A client-side navigation is silent otherwise, so the title is announced.
    $effect(() => {
        const title = t(route.titleKey);
        document.title = `${title} - Docknight`;
        announce(title);
    });

    let landed = false;

    // Keyed on the screen rather than the path: every screen is loaded with import(), so at the
    // moment the path changes the heading to focus does not exist yet. The first screen is skipped:
    // the browser already starts the user at the top of the document, and moving focus there paints
    // a ring on a title nobody navigated to.
    $effect(() => {
        const screen = notFound ? "notFound" : component;
        if (outlet === null || screen === null) return;
        if (!landed) {
            landed = true;
            return;
        }
        focusHeading(outlet);
    });

    async function onLogout(): Promise<void> {
        accountOpen = false;
        try {
            await logout();
        } catch (error) {
            toastError(error);
        }
    }
</script>

<div class="shell" data-audit-root data-grid-origin>
    <header class="header" data-audit-id="app-header" data-audit-row="center">
        <a class="brand" href="/" onclick={(event) => { event.preventDefault(); void navigate("/"); }}>
            <span class="brand-mark" aria-hidden="true"></span>
            <span class="brand-name type-title text-name">Docknight</span>
        </a>
        <div class="spacer"></div>
        <div class="account">
            <Button
                variant="text"
                iconType="left"
                aria-expanded={accountOpen}
                onclick={() => (accountOpen = !accountOpen)}
            >
                <Icon name="host" size="md" />
                {session.username ?? t("accountAnonymous")}
            </Button>
            {#if accountOpen}
                <div class="menu" role="menu" data-audit-id="account-menu" data-audit-column>
                    <button
                        type="button"
                        role="menuitem"
                        class="menu-item"
                        onclick={() => {
                            accountOpen = false;
                            void navigate("/settings/security");
                        }}
                    >
                        <Icon name="settings" size="sm" />
                        {t("navSecurity")}
                    </button>
                    <button type="button" role="menuitem" class="menu-item" onclick={() => void onLogout()}>
                        <Icon name="logout" size="sm" />
                        {t("actionLogout")}
                    </button>
                </div>
            {/if}
        </div>
    </header>

    <ConnectionBanner />

    <div class="body">
        <nav class="rail" aria-label={t("navPrimary")} data-audit-id="nav-rail" data-audit-column>
            {#each destinations as destination (destination.path)}
                <a
                    class="rail-item"
                    class:active={isActive(destination.path)}
                    href={destination.path}
                    aria-current={isActive(destination.path) ? "page" : undefined}
                    onclick={(event) => {
                        event.preventDefault();
                        void navigate(destination.path);
                    }}
                >
                    <span class="rail-indicator">
                        <Icon name={destination.icon} size="lg" />
                    </span>
                    <span class="rail-label type-label">{t(destination.key)}</span>
                </a>
            {/each}
        </nav>

        <aside class="panel" class:panel-home={isHome} data-audit-id="stack-panel" data-audit-column>
            <div class="panel-head" data-audit-row="center">
                <label class="search">
                    <span class="visually-hidden">{t("stackSearchLabel")}</span>
                    <Icon name="search" size="sm" />
                    <input
                        type="search"
                        bind:value={search}
                        placeholder={t("stackSearchPlaceholder")}
                        autocomplete="off"
                    />
                </label>
                <Button
                    variant="tonal"
                    iconType="left"
                    onclick={() => void navigate("/compose")}
                    aria-label={t("actionCreateStack")}
                >
                    <Icon name="add" size="md" />
                    {t("actionNew")}
                </Button>
            </div>
            <StackList filter={search} />
        </aside>

        <main class="outlet" bind:this={outlet} data-audit-id="route-outlet" data-audit-column>
            {#if notFound}
                <h1 class="type-headline">{t("routeNotFound")}</h1>
                <p class="type-body-large">{t("routeNotFoundBody")}</p>
            {:else if component !== null}
                {@const Screen = component}
                <Screen />
            {:else}
                <p class="type-body">{t("loading")}</p>
            {/if}
        </main>
    </div>
</div>

<style>
    /* Exactly the viewport, so the outlet scrolls inside the frame rather than growing the page and
       carrying the rail and the panel off the top with it. */
    .shell {
        display: flex;
        flex-direction: column;
        block-size: 100dvh;
        background-color: rgb(var(--m3-scheme-background));
    }

    .header {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        gap: var(--space-2);
        block-size: var(--size-control-lg);
        padding-inline: var(--space-3);
        background-color: rgb(var(--m3-scheme-surface-container));
        color: rgb(var(--m3-scheme-on-surface));
    }

    .brand {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        block-size: var(--size-control-lg);
        padding-inline: var(--space-2);
        border-radius: var(--radius-full);
        color: inherit;
        text-decoration: none;
    }

    .brand:hover {
        text-decoration: none;
    }

    .brand-mark {
        inline-size: var(--size-icon-lg);
        block-size: var(--size-icon-lg);
        border-radius: var(--radius-sm);
        background-color: rgb(var(--m3-scheme-primary));
    }

    .spacer {
        flex: 1;
    }

    .account {
        position: relative;
    }

    /* The menu hangs from the header's lower edge: the trigger is centred in the header, so its own
       height plus the leftover above it is what clears the bar. */
    .menu {
        position: absolute;
        inset-block-start: var(--size-control-lg);
        inset-inline-end: 0;
        z-index: 30;
        display: flex;
        flex-direction: column;
        min-inline-size: var(--measure-list);
        padding: var(--space-1);
        border-radius: var(--radius-lg);
        background-color: rgb(var(--m3-scheme-surface-container-high));
        box-shadow: var(--m3-util-elevation-2);
    }

    .menu-item {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        block-size: var(--size-control-lg);
        padding-inline: var(--space-4);
        border: 0;
        border-radius: var(--radius-full);
        background: none;
        color: rgb(var(--m3-scheme-on-surface));
        cursor: pointer;
        text-align: start;
    }

    .menu-item:hover {
        background-color: rgb(var(--m3-scheme-surface-container-highest));
    }

    .body {
        display: flex;
        flex: 1;
        min-block-size: 0;
    }

    .rail {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        inline-size: var(--size-nav-rail);
        padding-block: var(--space-2);
        background-color: rgb(var(--m3-scheme-surface-container-low));
    }

    /* 4 above the pill, 32 of pill, 4 of gap and a 16 label fill the 56 exactly. */
    .rail-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-1);
        block-size: var(--size-control-xl);
        padding-block-start: var(--space-1);
        color: rgb(var(--m3-scheme-on-surface-variant));
        text-decoration: none;
    }

    .rail-item:hover {
        text-decoration: none;
    }

    /* Material marks the active destination with a pill behind the icon alone, not with a block
       covering the label as well. */
    .rail-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        inline-size: var(--size-control-xl);
        block-size: var(--size-control-sm);
        border-radius: var(--radius-full);
    }

    .rail-item:hover .rail-indicator {
        background-color: rgb(var(--m3-scheme-surface-container-high));
    }

    .rail-item.active {
        color: rgb(var(--m3-scheme-on-surface));
    }

    .rail-item.active .rail-indicator {
        background-color: rgb(var(--m3-scheme-secondary-container));
        color: rgb(var(--m3-scheme-on-secondary-container));
    }

    .rail-label {
        text-align: center;
    }

    /* Positioned because a scroll pane clips only the descendants whose containing block is inside it.
       An absolutely positioned one that skips the pane, such as a visually hidden label, anchors to
       the page instead and stretches the document to wherever the scrolled content put it. */
    .panel {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        inline-size: var(--measure-list);
        padding: var(--space-2);
        overflow-y: auto;
        box-shadow: inset calc(-1 * var(--hairline)) 0 0 rgb(var(--m3-scheme-outline-variant));
    }

    .panel-head {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        /* The rule under the head is drawn rather than laid out, so what follows it stays on the
           grid. A hairline in the flow would shift every row below by a device pixel. */
        padding-block-end: var(--space-2);
        box-shadow: inset 0 calc(-1 * var(--hairline)) 0 rgb(var(--m3-scheme-outline-variant));
    }

    .search {
        display: flex;
        flex: 1;
        align-items: center;
        gap: var(--space-2);
        /* An input carries an intrinsic width, which would otherwise floor the label's min-content
           size and push the button out of the head. */
        min-inline-size: 0;
        block-size: var(--size-control-md);
        padding-inline: var(--space-3);
        border-radius: var(--radius-full);
        background-color: rgb(var(--m3-scheme-surface-container-high));
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .search input {
        flex: 1;
        align-self: stretch;
        min-inline-size: 0;
        border: 0;
        background: none;
        outline-offset: var(--space-1);
    }

    /* Positioned for the reason the panel is. */
    .outlet {
        position: relative;
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: var(--space-4);
        min-inline-size: 0;
        padding-inline: var(--space-5);
        padding-block: var(--space-4);
        overflow-y: auto;
    }

    /* One pane at a time below 840. A list beside a detail needs the expanded width: at 600 the panel
       alone takes half of it, and what is left holds neither a field nor a labelled button. */
    @media (width < 840px) {
        .panel {
            flex: 1;
            inline-size: auto;
            box-shadow: none;
        }

        .panel:not(.panel-home) {
            display: none;
        }

        .panel-home + .outlet {
            display: none;
        }

        .outlet {
            padding-inline: var(--space-4);
        }
    }

    @media (width < 600px) {
        .body {
            flex-direction: column;
        }

        .rail {
            flex-direction: row;
            flex-shrink: 0;
            order: 2;
            inline-size: 100%;
            block-size: var(--size-nav-rail);
            padding-block: var(--space-2);
        }

        .rail-item {
            flex: 1;
        }

        .outlet {
            padding-inline: var(--space-3);
        }
    }
</style>
