<script lang="ts">
    import { t } from "../../lib/stores/i18n.svelte.ts";

    interface Props {
        networks?: string[];
        available?: string[];
    }

    let { networks = $bindable(), available = [] }: Props = $props();

    let customName = $state("");

    function addNetwork(name: string): void {
        const trimmed = name.trim();
        if (trimmed === "") return;
        const current = networks ?? [];
        if (!current.includes(trimmed)) {
            networks = [...current, trimmed];
        }
        customName = "";
    }

    function removeNetwork(name: string): void {
        networks = (networks ?? []).filter((n) => n !== name);
    }
</script>

<div class="gcp-network-field" data-audit-column>
    <span class="text-label gcp-network-label" data-audit-heading>Networks</span>

    {#if (networks ?? []).length > 0}
        <div class="gcp-network-chips" data-audit-row="center">
            {#each networks ?? [] as net (net)}
                <div class="gcp-network-chip" data-audit-row="center">
                    <span class="text-label">{net}</span>
                    <button
                        type="button"
                        class="gcp-network-remove"
                        aria-label={t("network.remove", { name: net })}
                        onclick={() => removeNetwork(net)}
                    >
                        ✕
                    </button>
                </div>
            {/each}
        </div>
    {/if}

    <div class="gcp-network-actions" data-audit-row="center">
        {#if available.length > 0}
            <select
                class="gcp-network-select text-label"
                onchange={(e) => {
                    const val = e.currentTarget.value;
                    if (val !== "") {
                        addNetwork(val);
                        e.currentTarget.value = "";
                    }
                }}
            >
                <option value="">{t("network.select")}</option>
                {#each available as net (net)}
                    {#if !(networks ?? []).includes(net)}
                        <option value={net}>{net}</option>
                    {/if}
                {/each}
            </select>
        {/if}

        <input
            type="text"
            class="gcp-network-input text-label"
            placeholder={t("network.add")}
            aria-label={t("network.add")}
            bind:value={customName}
            onkeydown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    addNetwork(customName);
                }
            }}
        />
        <button
            type="button"
            class="gcp-network-add-btn text-label"
            onclick={() => addNetwork(customName)}
        >
            +
        </button>
    </div>
</div>

<style>
    .gcp-network-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        width: 100%;
    }

    .gcp-network-label {
        color: var(--m3c-on-surface-variant);
        font-weight: 500;
    }

    .gcp-network-chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    .gcp-network-chip {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        height: var(--size-control-md);
        padding-inline: var(--space-3) var(--space-1);
        border-radius: var(--radius-round);
        background: var(--m3c-secondary-container);
        color: var(--m3c-on-secondary-container);
    }

    .gcp-network-remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--size-icon-lg);
        height: var(--size-icon-lg);
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        border-radius: var(--radius-round);
    }

    .gcp-network-remove:hover {
        background: rgb(0 0 0 / 10%);
    }

    .gcp-network-actions {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
    }

    .gcp-network-select,
    .gcp-network-input {
        flex: 1;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
        font-family: inherit;
    }

    .gcp-network-add-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-md);
        block-size: var(--size-control-md);
        padding: 0;
        border: 1px dashed var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: transparent;
        color: var(--m3c-primary);
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        flex-shrink: 0;
    }

    .gcp-network-add-btn:hover {
        background: var(--m3c-surface-container-highest);
    }

    @media (pointer: coarse) {
        .gcp-network-add-btn {
            width: var(--size-control-lg);
            height: var(--size-control-lg);
        }
    }
</style>
