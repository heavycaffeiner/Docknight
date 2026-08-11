<script lang="ts">
    import EmptyState from "../components/EmptyState.svelte";
    import Loading from "../components/Loading.svelte";
    import TerminalView from "../components/TerminalView.svelte";
    import { request } from "../lib/connection.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { toastError } from "../lib/stores/toast.svelte.ts";
    import { route } from "../router.svelte.ts";

    const endpoint = $derived(route.params.endpoint ?? "");

    let terminal = $state<string | null>(null);
    let disabled = $state(false);

    $effect(() => {
        const target = endpoint;
        terminal = null;
        disabled = false;

        void request(target, "terminal.main", undefined)
            .then((result) => {
                terminal = result.terminal;
            })
            .catch((error: unknown) => {
                disabled = true;
                toastError(error);
            });
    });
</script>

<h1 class="type-headline" data-route-heading>{t("consoleTitle")}</h1>

{#if disabled}
    <EmptyState
        title={t("consoleDisabledTitle")}
        body={t("consoleDisabledBody")}
        auditId="console-disabled"
    />
{:else if terminal !== null}
    <p class="warning type-body" data-audit-id="console-warning">{t("consoleBody")}</p>
    <TerminalView {endpoint} {terminal} interactive rows={40} label={t("consoleTitle")} />
{:else}
    <Loading auditId="console-loading" />
{/if}

<style>
    h1 {
        margin: 0;
    }

    .warning {
        margin: 0;
        padding: var(--space-3);
        border-radius: var(--radius-md);
        background-color: rgb(var(--m3-scheme-tertiary-container));
        color: rgb(var(--m3-scheme-on-tertiary-container));
    }
</style>
