<script lang="ts">
    import { connectionInit, connectionState } from "./lib/connection.svelte.ts";
    import { trackViewport } from "./lib/viewport.svelte.ts";
    import { on } from "./lib/connection.svelte.ts";
    import { session, resume } from "./lib/stores/session.svelte.ts";
    import { settings } from "./lib/stores/settings.svelte.ts";
    import { reevaluate, route, routerInit } from "./router.svelte.ts";
    import Layout from "./components/Layout.svelte";
    import Login from "./pages/Login.svelte";
    import Setup from "./pages/Setup.svelte";
    import ToastHost from "./components/ToastHost.svelte";

    let needsSetup = $state(false);
    let everConnected = $state(false);
    let startedVersion: string | null = null;

    $effect(() => {
        const unsubscribeViewport = trackViewport();
        connectionInit();

        const unsubscribeSetup = on("setup", () => {
            needsSetup = true;
        });
        const unsubscribeRefresh = on("refresh", () => {
            location.reload();
        });

        void resume().finally(() => {
            everConnected = true;
            routerInit(needsSetup);
        });

        return () => {
            unsubscribeViewport();
            unsubscribeSetup();
            unsubscribeRefresh();
        };
    });

    $effect(() => {
        if (session.state === "authenticated") {
            needsSetup = false;
            reevaluate(false);
        }
    });

    $effect(() => {
        const version = settings.info?.version;
        if (version === undefined) return;
        if (startedVersion === null) {
            startedVersion = version;
            return;
        }
        if (version !== startedVersion) {
            // The served bundle no longer matches the server; reload picks up the new one.
            location.reload();
        }
    });
</script>

<div id="route-announcer" class="sr-only" aria-live="polite" role="status"></div>

{#if connectionState.value === "connecting" && !everConnected}
    <div class="boot" role="status">
        <span class="text-body-large">Docknight is starting…</span>
    </div>
{:else if needsSetup}
    <Setup />
{:else if session.state !== "authenticated"}
    <Login />
{:else}
    <Layout>
        {#if route.component !== null}
            {@const Component = route.component}
            <Component />
        {/if}
    </Layout>
{/if}

<ToastHost />

<style>
    .sr-only {
        position: absolute;
        width: var(--space-1);
        height: var(--space-1);
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }

    .boot {
        display: flex;
        align-items: center;
        justify-content: center;
        block-size: 100dvh;
    }
</style>
