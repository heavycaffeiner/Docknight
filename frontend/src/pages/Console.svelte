<script lang="ts">
    import { request } from "../lib/connection.svelte.ts";
    import { route } from "../router.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { toastError } from "../lib/stores/toast.svelte.ts";
    import EmptyState from "../components/EmptyState.svelte";
    import TerminalView from "../components/TerminalView.svelte";

    const endpoint = $derived(route.params.endpoint ?? "");

    let enabled = $state<boolean | null>(null);
    let terminalName = $state<string | null>(null);

    $effect(() => {
        enabled = null;
        terminalName = null;
        request(endpoint, "terminal.mainEnabled", undefined)
            .then((result) => {
                enabled = result.enabled;
                if (!result.enabled) return undefined;
                return request(endpoint, "terminal.main", undefined).then((r) => {
                    terminalName = r.terminal;
                });
            })
            .catch((error: unknown) => {
                // Without this the rejection is unhandled and the screen stays blank with no
                // indication that opening the host shell failed at all.
                enabled = false;
                toastError(error);
            });
    });
</script>

<div class="page" data-audit-root data-grid-origin>
    {#if enabled === false}
        <EmptyState message={t("console.disabled")} />
    {:else if terminalName !== null}
        <div class="pane">
            <TerminalView {endpoint} terminal={terminalName} interactive rows={40} />
        </div>
    {/if}
</div>

<style>
    .page {
        display: flex;
        flex-direction: column;
        padding: var(--space-4);
        block-size: 100%;
    }

    .pane {
        flex: 1;
        min-height: 0;
    }
</style>
