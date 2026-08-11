<script lang="ts">
    import Layout from "./components/Layout.svelte";
    import Loading from "./components/Loading.svelte";
    import ToastHost from "./components/ToastHost.svelte";
    import Login from "./pages/Login.svelte";
    import Setup from "./pages/Setup.svelte";
    import { connection } from "./lib/connection.svelte.ts";
    import { t } from "./lib/stores/i18n.svelte.ts";
    import { session } from "./lib/stores/session.svelte.ts";
    import { trackViewport } from "./lib/viewport.ts";
    import { route } from "./router.svelte.ts";

    // The shell is sized from the visible viewport rather than from the layout one, so a keyboard
    // takes height from the page instead of covering the bottom of it.
    $effect(trackViewport);

    /**
     * The gate, in priority order: first-connect progress, setup, login, then the routed screen.
     * The session store moves to authenticated on three signals, so a deployment that turned
     * login off is not shown a login form.
     */
    const phase = $derived.by(() => {
        if (!connection.everConnected && connection.state !== "connected") return "connecting";
        if (session.needsSetup) return "setup";
        if (session.state === "anonymous") return "login";
        if (session.state === "authenticating") return "connecting";
        return "app";
    });
</script>

<svelte:boundary>
    {#if phase === "connecting"}
        <div class="full" data-audit-id="boot-progress">
            <Loading label={t("connectionConnecting")} />
        </div>
    {:else if phase === "setup"}
        <Setup />
    {:else if phase === "login"}
        <Login />
    {:else}
        <Layout component={route.component} notFound={route.notFound} />
    {/if}

    {#snippet failed(error, reset)}
        <div class="full" data-audit-id="boundary-error">
            <h1 class="type-headline">{t("errorUnexpected")}</h1>
            <p class="type-body">{error instanceof Error ? error.message : String(error)}</p>
            <button type="button" class="reload" onclick={reset}>{t("actionReload")}</button>
        </div>
    {/snippet}
</svelte:boundary>

<ToastHost />

<style>
    .full {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-3);
        min-block-size: 100vh;
        padding: var(--space-5);
        color: rgb(var(--m3-scheme-on-background));
    }

    .reload {
        block-size: var(--size-control-md);
        padding-inline: var(--space-5);
        border: 0;
        border-radius: var(--radius-full);
        box-shadow: inset 0 0 0 var(--hairline) rgb(var(--m3-scheme-outline));
        background-color: rgb(var(--m3-scheme-surface-container));
        color: rgb(var(--m3-scheme-on-surface));
        cursor: pointer;
    }
</style>
