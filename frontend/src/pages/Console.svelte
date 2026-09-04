<script lang="ts">
    import { onMount } from "svelte";
    import { request } from "../lib/connection.svelte.ts";
    import { route } from "../router.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import TerminalView from "../components/TerminalView.svelte";
    import EmptyState from "../components/EmptyState.svelte";

    const endpoint = $derived(route.params.endpoint ?? "");

    let loading = $state(true);
    let enabled = $state(false);
    let terminalName = $state<string | null>(null);

    onMount(() => {
        void request<{ enabled?: boolean }>(endpoint, "terminal.mainEnabled", undefined)
            .then((res) => {
                enabled = res.enabled === true;
                if (enabled) {
                    return request<{ terminal?: string }>(endpoint, "terminal.main", undefined);
                }
                return null;
            })
            .then((res) => {
                if (res && res.terminal) {
                    terminalName = res.terminal;
                }
            })
            .catch(() => {
                enabled = false;
            })
            .finally(() => {
                loading = false;
            });
    });
</script>

<div class="gcp-console-page" data-audit-root>
    <div class="gcp-console-header" data-audit-row="center">
        <h1 class="text-headline">{t("nav.console")}</h1>
    </div>

    {#if loading}
        <div class="gcp-console-loading" data-audit-column>
            <span class="text-body-medium">Checking host console status...</span>
        </div>
    {:else if !enabled}
        <div class="gcp-console-card" data-audit-column>
            <EmptyState
                message={t("console.disabled")}
                actionLabel={t("nav.settings")}
                actionHref="/settings/general"
            />
        </div>
    {:else if terminalName !== null}
        <div class="gcp-console-terminal" data-audit-column>
            <TerminalView
                {endpoint}
                terminal={terminalName}
                interactive={true}
                rows={30}
            />
        </div>
    {/if}
</div>

<style>
    .gcp-console-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: var(--space-4);
        gap: var(--space-4);
    }

    .gcp-console-header {
        display: flex;
        align-items: center;
        min-height: var(--size-control-md);
    }

    .gcp-console-loading,
    .gcp-console-card {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-sm);
        background: var(--m3c-surface-container-low);
        padding: var(--space-6);
    }

    .gcp-console-terminal {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
</style>
