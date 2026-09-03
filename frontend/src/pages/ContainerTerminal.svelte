<script lang="ts">
    import { request } from "../lib/connection.svelte.ts";
    import { navigate, route } from "../router.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { toastError } from "../lib/stores/toast.svelte.ts";
    import TerminalView from "../components/TerminalView.svelte";

    const endpoint = $derived(route.params.endpoint ?? "");
    const stack = $derived(route.params.stack ?? "");
    const service = $derived(route.params.service ?? "");
    const shell = $derived(route.params.type ?? "sh");

    let terminalName = $state<string | null>(null);

    $effect(() => {
        terminalName = null;
        void request(endpoint, "terminal.exec", { stack, service, shell })
            .then((result) => {
                terminalName = result.terminal;
            })
            .catch((error: unknown) => {
                toastError(error);
            });
    });

    function backToStack(): void {
        void navigate(endpoint === "" ? `/compose/${stack}` : `/compose/${stack}/${endpoint}`);
    }
</script>

<div class="gcp-terminal-page" data-audit-root data-grid-origin>
    <div class="gcp-terminal-header" data-audit-row="center">
        <button
            type="button"
            class="gcp-back-btn"
            aria-label={t("action.back")}
            onclick={backToStack}
        >
            ←
        </button>
        <h1 class="text-title gcp-terminal-title">{stack}/{service} ({shell})</h1>
    </div>

    <div class="gcp-terminal-body" data-audit-column data-grid-origin>
        {#if terminalName !== null}
            <TerminalView {endpoint} terminal={terminalName} interactive={true} rows={32} />
        {/if}
    </div>
</div>

<style>
    .gcp-terminal-page {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        padding: var(--space-4);
        block-size: 100%;
    }

    .gcp-terminal-header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        height: var(--size-control-xl);
    }

    .gcp-back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-lg);
        height: var(--size-control-lg);
        border: none;
        background: transparent;
        color: var(--m3c-on-surface);
        cursor: pointer;
        flex-shrink: 0;
    }

    .gcp-terminal-title {
        min-width: 0;
        overflow-wrap: anywhere;
        font-weight: 600;
    }

    .gcp-terminal-body {
        flex: 1;
        min-height: var(--measure-editor-lg);
        display: flex;
        flex-direction: column;
    }
</style>
