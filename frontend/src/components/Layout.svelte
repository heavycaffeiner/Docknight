<script lang="ts">
    import type { Component } from "svelte";
    import { Button, MenuItem } from "m3-svelte";
    import ConnectionBanner from "./ConnectionBanner.svelte";
    import Icon from "./Icon.svelte";
    import Loading from "./Loading.svelte";
    import MenuButton from "./MenuButton.svelte";
    import StackList from "./StackList.svelte";
    import { announce, focusHeading } from "../lib/a11y.ts";
    import { bottomBar } from "../lib/stores/chrome.svelte.ts";
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

    const accountName = $derived(session.username ?? t("accountAnonymous"));

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
        try {
            await logout();
        } catch (error) {
            toastError(error);
        }
    }
</script>

<div class="shell" class:has-app-bar={bottomBar.present} data-audit-root data-grid-origin>
    <header class="header" data-audit-id="app-header" data-audit-row="center">
        <a class="brand" href="/" onclick={(event) => { event.preventDefault(); void navigate("/"); }}>
            <span class="brand-mark" aria-hidden="true"></span>
            <span class="brand-name type-title text-name">Docknight</span>
        </a>
        <div class="spacer"></div>
        <MenuButton label={accountName} auditId="account-menu">
            {#snippet trigger()}
                <Icon name="host" size="md" />
                <span class="account-name">{accountName}</span>
            {/snippet}
            {#snippet children(close)}
                <MenuItem
                    onclick={() => {
                        close();
                        void navigate("/settings/security");
                    }}
                >
                    {t("navSecurity")}
                </MenuItem>
                <MenuItem
                    onclick={() => {
                        close();
                        void onLogout();
                    }}
                >
                    {t("actionLogout")}
                </MenuItem>
            {/snippet}
        </MenuButton>
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

        <aside class="panel" data-audit-id="stack-panel" data-audit-column>
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
                <Loading auditId="outlet-loading" />
            {/if}
        </main>
    </div>
</div>

<style>
    /* Exactly the visible viewport, so the outlet scrolls inside the frame rather than growing the
       page and carrying the rail and the panel off the top with it. `--viewport-block` already has
       the keyboard subtracted; `100dvh` is the fallback where no visual viewport is reported. */
    .shell {
        display: flex;
        flex-direction: column;
        block-size: var(--viewport-block, 100dvh);
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

    /* A long account name would otherwise push the brand off the header, so it truncates instead. */
    .account-name {
        max-inline-size: var(--measure-list);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .body {
        display: flex;
        flex: 1;
        min-block-size: 0;
    }

    /* Eight between destinations rather than four: two 56px targets that all but touch are one
       target as far as a thumb is concerned. */
    .rail {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
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

    /* A page that scrolls does not compress what is on it: flex shrinking runs before the scrollbar
       appears, so every child would give up height it was never going to get back. */
    .outlet > :global(*) {
        flex-shrink: 0;
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

    /* Navigation is not the task while a field is being typed into, and a bar the keyboard covers is
       one the reader cannot dismiss. A screen's own bottom app bar carries the current task instead,
       so this is scoped to the rail by construction rather than by review. */
    :global(html[data-keyboard="open"]) .rail {
        display: none;
    }

    /* Two bottom bars never stack: a screen that brings its own replaces the destinations. */
    .shell.has-app-bar .rail {
        display: none;
    }

    /* Room for the bar the screen has fixed over the bottom of the outlet, which is exactly as much
       as the bar takes. */
    .shell.has-app-bar .outlet {
        padding-block-end: var(--size-nav-bar);
    }

    /* One pane at a time below 840. A list beside a detail needs the expanded width: at 600 the panel
       alone takes half of it, and what is left holds neither a field nor a labelled button. The list
       is not lost with the panel: the Dashboard renders it as its own first card at these widths. */
    @media (width < 840px) {
        .panel {
            display: none;
        }

        .outlet {
            flex: 1;
            padding-inline: var(--space-4);
        }
    }

    @media (width < 600px) {
        .body {
            flex-direction: column;
        }

        /* The bar is the destinations and nothing else: the eight above and below them was slack
           the rail could afford on a desktop and a phone cannot. */
        .rail {
            flex-direction: row;
            flex-shrink: 0;
            order: 2;
            inline-size: 100%;
            block-size: var(--size-nav-bar);
            padding-block: var(--space-1);
        }

        .rail-item {
            flex: 1;
        }

        .outlet {
            gap: var(--space-3);
            padding-inline: var(--space-3);
            padding-block: var(--space-3);
        }
    }
</style>
