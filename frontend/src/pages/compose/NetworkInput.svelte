<script lang="ts">
    interface Props {
        networks: string[];
        available: string[];
    }

    let { networks = $bindable(), available }: Props = $props();

    let selection = $state("");

    function addNetwork(): void {
        if (selection === "" || networks.includes(selection)) return;
        networks = [...networks, selection];
        selection = "";
    }

    function removeNetwork(name: string): void {
        networks = networks.filter((n) => n !== name);
    }
</script>

<div class="network-input" data-audit-column data-audit-id="network-input">
    {#each networks as name (name)}
        <div class="row" data-audit-row="center">
            <span class="text-body-medium">{name}</span>
            <button type="button" class="remove" aria-label="Remove {name}" onclick={() => removeNetwork(name)}>
                ✕
            </button>
        </div>
    {/each}
    <div class="add-row" data-audit-row="center">
        <select bind:value={selection} aria-label="Add network">
            <option value="">Select a network</option>
            {#each available.filter((n) => !networks.includes(n)) as name (name)}
                <option value={name}>{name}</option>
            {/each}
        </select>
        <button type="button" class="add" onclick={addNetwork} disabled={selection === ""}>+</button>
    </div>
</div>

<style>
    .network-input {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .row,
    .add-row {
        display: flex;
        gap: var(--space-2);
        height: var(--size-control-md);
    }

    select {
        flex: 1;
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
    }

    .remove,
    .add {
        width: var(--size-control-md);
        height: var(--size-control-md);
        border: none;
        border-radius: var(--radius-xs);
        background: transparent;
        color: var(--m3c-on-surface-variant);
        cursor: pointer;
    }

    .add:disabled {
        opacity: 0.5;
        cursor: default;
    }
</style>
