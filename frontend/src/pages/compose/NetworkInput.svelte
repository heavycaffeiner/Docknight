<script lang="ts">
    import { SvelteSet } from "svelte/reactivity";

    interface Props {
        networks: string[] | undefined;
        available: string[];
    }

    let { networks = $bindable(), available }: Props = $props();

    let customNetwork = $state("");

    function toggle(net: string): void {
        const current = new SvelteSet(networks ?? []);
        if (current.has(net)) current.delete(net);
        else current.add(net);
        networks = Array.from(current);
    }

    function addCustom(): void {
        const trimmed = customNetwork.trim();
        if (trimmed === "") return;
        const current = new SvelteSet(networks ?? []);
        current.add(trimmed);
        networks = Array.from(current);
        customNetwork = "";
    }
</script>

<div class="gcp-network-field" data-audit-column>
    <span class="text-label gcp-network-label" data-audit-heading>Networks</span>
    <div class="gcp-network-list" data-audit-column>
        {#each available as net (net)}
            <label class="gcp-network-item" data-audit-row="center">
                <input
                    type="checkbox"
                    checked={(networks ?? []).includes(net)}
                    onchange={() => toggle(net)}
                />
                <span class="text-body-medium">{net}</span>
            </label>
        {/each}
    </div>
    <div class="gcp-network-custom-row" data-audit-row="center">
        <input
            type="text"
            class="gcp-network-input"
            placeholder="custom-network"
            aria-label="custom network name"
            bind:value={customNetwork}
            onkeydown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                }
            }}
        />
        <button type="button" class="gcp-network-add-btn" onclick={addCustom}>
            +
        </button>
    </div>
</div>

<style>
    .gcp-network-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .gcp-network-label {
        color: var(--m3c-on-surface-variant);
        font-weight: 500;
    }

    .gcp-network-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    .gcp-network-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-height: var(--size-control-md);
        cursor: pointer;
    }

    .gcp-network-custom-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .gcp-network-input {
        flex: 1;
        min-width: 0;
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
        font-size: 13px;
    }

    .gcp-network-input:focus {
        border-color: var(--m3c-primary);
    }

    .gcp-network-add-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-md);
        height: var(--size-control-md);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        font-size: 14px;
        cursor: pointer;
        flex-shrink: 0;
    }

    .gcp-network-add-btn:hover {
        background: var(--m3c-surface-container-highest);
    }
</style>
