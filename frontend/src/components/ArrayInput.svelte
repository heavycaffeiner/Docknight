<script lang="ts">
    import { Button } from "m3-svelte";
    import Icon from "./Icon.svelte";
    import { t } from "../lib/stores/i18n.svelte.ts";

    /**
     * One row per entry, shared by ports, volumes, environment and dependencies. The placeholder
     * shows the expected shape, which is what keeps the four uses from needing four editors.
     */
    interface Props {
        label: string;
        placeholder: string;
        values: string[];
        auditId: string;
        onchange: (next: string[]) => void;
    }

    const { label, placeholder, values, auditId, onchange }: Props = $props();

    function update(index: number, value: string): void {
        const next = [...values];
        next[index] = value;
        onchange(next);
    }

    function remove(index: number): void {
        onchange(values.filter((_, position) => position !== index));
    }

    function move(index: number, delta: number): void {
        const target = index + delta;
        if (target < 0 || target >= values.length) return;
        const next = [...values];
        const [item] = next.splice(index, 1);
        next.splice(target, 0, item as string);
        onchange(next);
    }
</script>

<fieldset class="group" data-audit-id={auditId} data-audit-column>
    <legend class="type-label">{label}</legend>
    {#each values as value, index (index)}
        <div class="row" data-audit-row="center">
            <input
                class="field type-mono"
                type="text"
                {placeholder}
                value={value}
                aria-label="{label} {index + 1}"
                oninput={(event) => update(index, event.currentTarget.value)}
            />
            <button
                type="button"
                class="icon-button"
                aria-label={t("actionMoveUp")}
                disabled={index === 0}
                onclick={() => move(index, -1)}
            >
                <Icon name="chevron-down" size="sm" />
            </button>
            <button
                type="button"
                class="icon-button"
                aria-label={t("actionMoveDown")}
                disabled={index === values.length - 1}
                onclick={() => move(index, 1)}
            >
                <Icon name="chevron-down" size="sm" />
            </button>
            <button
                type="button"
                class="icon-button"
                aria-label={t("actionRemove")}
                onclick={() => remove(index)}
            >
                <Icon name="close" size="sm" />
            </button>
        </div>
    {/each}
    <div class="add">
        <Button variant="text" iconType="left" onclick={() => onchange([...values, ""])}>
            <Icon name="add" size="md" />
            {t("actionAdd")}
        </Button>
    </div>
</fieldset>

<style>
    .group {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        margin: 0;
        padding: 0;
        border: 0;
    }

    legend {
        padding: 0;
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .field {
        flex: 1;
        min-inline-size: 0;
        block-size: var(--size-control-md);
        padding-inline: var(--space-4);
        border: 0;
        border-radius: var(--radius-md);
        box-shadow: inset 0 0 0 var(--hairline) rgb(var(--m3-scheme-outline));
        background-color: rgb(var(--m3-scheme-surface));
        color: rgb(var(--m3-scheme-on-surface));
    }

    .icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: var(--size-control-md);
        block-size: var(--size-control-md);
        padding: 0;
        border: 0;
        border-radius: var(--radius-full);
        background: none;
        color: rgb(var(--m3-scheme-on-surface-variant));
        cursor: pointer;
    }

    .icon-button:hover:not(:disabled) {
        background-color: rgb(var(--m3-scheme-surface-container-high));
    }

    .icon-button:disabled {
        opacity: 0.38;
        cursor: default;
    }

    /* The second and first arrows are the same glyph rotated, which keeps the icon set small. */
    .row .icon-button:nth-of-type(1) :global(svg) {
        rotate: 180deg;
    }

    .add {
        display: flex;
        justify-content: flex-start;
    }
</style>
