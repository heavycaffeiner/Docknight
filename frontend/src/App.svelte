<script lang="ts">
    import { onMount } from "svelte";
    import { connectionInit, connectionState, on } from "./lib/connection.svelte.ts";
    import { trackViewport } from "./lib/viewport.svelte.ts";
    import { session, resume } from "./lib/stores/session.svelte.ts";
    import { route, routerInit, reevaluate, setup } from "./router.svelte.ts";
    import Layout from "./components/Layout.svelte";
    import Login from "./pages/Login.svelte";
    import Setup from "./pages/Setup.svelte";
    import ToastHost from "./components/ToastHost.svelte";

    let everConnected = $state(false);

    $effect(() => {
        if (connectionState.phase === "connected" || connectionState.phase === "authed") {
            everConnected = true;
        }
    });

    onMount(() => {
        const cleanupViewport = trackViewport();
        connectionInit();
        routerInit();

        const unsubSetup = on("setup", () => {
            setup.needed = true;
        });

        const unsubRefresh = on("refresh", () => {
            location.reload();
        });

        void resume().finally(() => {
            void reevaluate();
        });

        return () => {
            cleanupViewport();
            unsubSetup();
            unsubRefresh();
        };
    });
</script>

{#if !everConnected && connectionState.phase === "connecting"}
    <div class="gcp-startup" data-audit-column>
        <span class="text-body-large">Docknight is starting...</span>
    </div>
{:else if setup.needed}
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
    .gcp-startup {
        display: flex;
        align-items: center;
        justify-content: center;
        block-size: var(--viewport-block, 100dvh);
        background: var(--m3c-surface);
        color: var(--m3c-on-surface);
    }
</style>
