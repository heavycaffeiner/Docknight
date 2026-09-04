<script lang="ts">
    import { onMount } from "svelte";
    import { request } from "../lib/connection.svelte.ts";
    import { route, navigate } from "../router.svelte.ts";
    import TerminalView from "../components/TerminalView.svelte";

    const stackName = $derived(route.params.stack ?? "");
    const serviceName = $derived(route.params.service ?? "");
    const shellType = $derived(route.params.type ?? "sh");
    const endpoint = $derived(route.params.endpoint ?? "");

    let terminalName = $state<string | null>(null);
    let loading = $state(true);
    let errorMessage = $state<string | null>(null);

    function backUrl(): string {
        return endpoint === "" ? `/compose/${stackName}` : `/compose/${stackName}/${encodeURIComponent(endpoint)}`;
    }

    onMount(() => {
        void request<{ terminal?: string }>(endpoint, "terminal.exec", {
            stack: stackName,
            service: serviceName,
            shell: shellType,
        })
            .then((res) => {
                terminalName = res.terminal ?? null;
            })
            .catch((err: unknown) => {
                errorMessage = err && typeof err === "object" && "message" in err ? String(err.message) : "Failed to launch shell";
            })
            .finally(() => {
                loading = false;
            });
    });
</script>

<div class="gcp-terminal-page" data-audit-root>
    <div class="gcp-terminal-header" data-audit-row="center">
        <a
            href={backUrl()}
            class="gcp-back-btn text-label"
            onclick={(e) => {
                e.preventDefault();
                void navigate(backUrl());
            }}
        >
            ← {stackName}
        </a>
        <h1 class="text-headline gcp-terminal-title">{serviceName} ({shellType})</h1>
    </div>

    {#if loading}
        <div class="gcp-terminal-loading" data-audit-column>
            <span class="text-body-medium">Connecting to shell...</span>
        </div>
    {:else if errorMessage !== null}
        <div class="gcp-terminal-error" role="alert" data-audit-column>
            <span class="text-body-medium">{errorMessage}</span>
        </div>
    {:else if terminalName !== null}
        <div class="gcp-terminal-content" data-audit-column>
            <TerminalView
                {endpoint}
                terminal={terminalName}
                interactive={true}
                rows={28}
            />
        </div>
    {/if}
</div>

<style>
    .gcp-terminal-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: var(--space-4);
        gap: var(--space-3);
    }

    .gcp-terminal-header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        min-height: var(--size-control-md);
    }

    .gcp-back-btn {
        display: inline-flex;
        align-items: center;
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        text-decoration: none;
        cursor: pointer;
    }

    .gcp-back-btn:hover {
        background: var(--m3c-surface-container-highest);
    }

    .gcp-terminal-title {
        font-weight: 500;
    }

    .gcp-terminal-loading,
    .gcp-terminal-error {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--space-8);
        border-radius: var(--radius-xs);
        border: 1px solid var(--m3c-outline-variant);
        background: var(--m3c-surface-container-low);
    }

    .gcp-terminal-error {
        color: var(--m3c-error);
    }

    .gcp-terminal-content {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
</style>
