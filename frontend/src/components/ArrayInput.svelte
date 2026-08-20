<script lang="ts">
    import { t } from "../lib/stores/i18n.svelte.ts";

    interface Props {
        items: string[];
        placeholder?: string;
        label: string;
    }

    let { items = $bindable(), placeholder, label }: Props = $props();

    function addRow(): void {
        items = [...items, ""];
    }

    function removeRow(index: number): void {
        items = items.filter((_, i) => i !== index);
    }

    function updateRow(index: number, value: string): void {
        items = items.map((item, i) => (i === index ? value : item));
    }
</script>

<!--
  No reorder controls at any width, per proposal 7: order in compose (ports, volumes,
  environment, depends_on, networks) carries no meaning, and the YAML editor is where an
  order that matters to a reader is set.
-->
<div class="array-input" data-audit-column data-audit-id="array-input-{label}">
    <span class="label text-label" data-audit-heading>{label}</span>
    {#each items as item, index (index)}
        <div class="row" data-audit-row="center">
            <input
                class="text-mono"
                type="text"
                value={item}
                {placeholder}
                aria-label={label}
                oninput={(event) => updateRow(index, event.currentTarget.value)}
            />
            <button
                type="button"
                class="remove"
                aria-label={t("service.action.remove")}
                onclick={() => removeRow(index)}
            >
                ✕
            </button>
        </div>
    {/each}
    <button type="button" class="add" onclick={addRow}>+ {label}</button>
</div>

<style>
    .array-input {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .label {
        color: var(--m3c-on-surface-variant);
    }

    .row {
        display: flex;
        gap: var(--space-2);
    }

    input {
        flex: 1;
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
    }

    .remove {
        width: var(--size-control-md);
        height: var(--size-control-md);
        border: none;
        border-radius: var(--radius-xs);
        background: transparent;
        color: var(--m3c-on-surface-variant);
        cursor: pointer;
    }

    .add {
        align-self: flex-start;
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 1px dashed var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: transparent;
        color: var(--m3c-primary);
        cursor: pointer;
    }
</style>
