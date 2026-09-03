<script lang="ts">
    import { request } from "../lib/connection.svelte.ts";
    import { navigate, route } from "../router.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { toastError } from "../lib/stores/toast.svelte.ts";
    import TerminalView from "../components/TerminalView.svelte";

    const endpoint = $derived(route.params.endpoint ?? "");
    const stackName = $derived(route.params.stack ?? "");
    const service = $derived(route.params.service ?? "");
    const shell = $derived(route.params.type ?? "sh");

    let terminalName = $state<string | null>(null);

    $effect(() => {
        terminalName = null;
        request(endpoint, "terminal.exec", { stack: stackName, service, shell })
            .then((result) => {
                terminalName = result.terminal;
            })
            .catch((error: unknown) => {
                toastError(error);
            });
    });

    function backToStack(): void {
        void navigate(endpoint === "" ? `/compose/${stackName}` : `/compose/${stackName}/${endpoint}`);
    }
</script>

<div class="page" data-audit-root data-grid-origin>
    <div class="breadcrumb" data-audit-row="center">
        <button type="button" class="back" aria-label={t("action.back")} onclick={backToStack}>
            ←
        </button>
        <h1 class="text-title terminal-title">{stackName} / {service}</h1>
    </div>
    {#if terminalName !== null}
        <div class="pane">
            <TerminalView {endpoint} terminal={terminalName} interactive rows={24} />
        </div>
    {/if}
</div>

<style>
    .page {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        padding: var(--space-4);
        block-size: 100%;
    }

    .breadcrumb {
        display: flex;
        gap: var(--space-3);
        height: var(--size-control-md);
    }

    .back {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-md);
        height: var(--size-control-md);
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--m3c-on-surface);
        font-size: 18px;
        cursor: pointer;
        transition: background-color 150ms ease;
    }

    .back:hover {
        background: var(--m3c-surface-container-high);
    }

    .terminal-title {
        font-weight: 600;
    }

    .pane {
        flex: 1;
        min-height: 0;
    }
</style>
