<script lang="ts">
    import { t } from "../lib/stores/i18n.svelte.ts";

    interface Props {
        items: string[] | undefined;
        label: string;
        placeholder?: string;
    }

    let { items = $bindable(), label, placeholder = "" }: Props = $props();

    let newItem = $state("");

    function add(): void {
        const trimmed = newItem.trim();
        if (trimmed === "") return;
        items = [...(items ?? []), trimmed];
        newItem = "";
    }

    function remove(index: number): void {
        items = (items ?? []).filter((_, i) => i !== index);
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter") {
            event.preventDefault();
            add();
        }
    }
</script>

<div class="gcp-array-field" data-audit-column>
    <span class="text-label gcp-array-label" data-audit-heading>{label}</span>
    <div class="gcp-array-items" data-audit-column>
        {#each items ?? [] as item, i (i)}
            <div class="gcp-array-row" data-audit-row="center">
                <input
                    type="text"
                    class="gcp-array-input"
                    value={item}
                    aria-label="{label} {i + 1}"
                    oninput={(e) => {
                        const next = [...(items ?? [])];
                        next[i] = e.currentTarget.value;
                        items = next;
                    }}
                />
                <button
                    type="button"
                    class="gcp-array-remove"
                    aria-label={t("service.action.remove")}
                    onclick={() => remove(i)}
                >
                    ✕
                </button>
            </div>
        {/each}
    </div>
    <div class="gcp-array-add-row" data-audit-row="center">
        <input
            type="text"
            class="gcp-array-input"
            {placeholder}
            aria-label={label}
            bind:value={newItem}
            onkeydown={onKeydown}
        />
        <button type="button" class="gcp-array-add-btn" onclick={add}>
            +
        </button>
    </div>
</div>

<style>
    .gcp-array-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        width: 100%;
    }

    .gcp-array-label {
        color: var(--m3c-on-surface-variant);
        font-weight: 500;
    }

    .gcp-array-items {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .gcp-array-row,
    .gcp-array-add-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
    }

    .gcp-array-input {
        flex: 1;
        min-width: 0;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
        font-family: "JetBrains Mono", monospace;
        font-size: 13px;
    }

    .gcp-array-remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-md);
        block-size: var(--size-control-md);
        padding: 0;
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: transparent;
        color: var(--m3c-on-surface);
        cursor: pointer;
        font-size: 14px;
        flex-shrink: 0;
    }

    .gcp-array-remove:hover {
        background: var(--m3c-surface-container-highest);
        color: var(--m3c-error);
    }

    .gcp-array-add-btn {
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

    .gcp-array-add-btn:hover {
        background: var(--m3c-surface-container-highest);
    }

    @media (pointer: coarse) {
        .gcp-array-remove,
        .gcp-array-add-btn {
            width: var(--size-control-lg);
            height: var(--size-control-lg);
        }
    }
</style>
