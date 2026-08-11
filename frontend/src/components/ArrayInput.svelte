<script lang="ts">
    import { Button, TextFieldOutlined } from "m3-svelte";
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

    const hintId = $props.id();

    function update(index: number, value: string): void {
        const next = [...values];
        next[index] = value;
        onchange(next);
    }

    function remove(index: number): void {
        onchange(values.filter((_, position) => position !== index));
    }
</script>

<fieldset class="group" data-audit-id={auditId} data-audit-column>
    <legend class="type-label">{label}</legend>
    <!-- The expected shape is stated once for the group. A field's own label floats over its
         placeholder, so repeating it per row would collide with the row number. -->
    <p class="hint type-label" id={hintId}>{placeholder}</p>
    {#each values as value, index (index)}
        <div class="row" data-audit-row="center">
            <div class="field">
                <TextFieldOutlined
                    label="{label} {index + 1}"
                    class="type-mono"
                    {value}
                    aria-describedby={hintId}
                    oninput={(event) => update(index, event.currentTarget.value)}
                />
            </div>
            <!-- No reorder controls: compose reads none of these lists in order, so the buttons
                 rearranged something nothing observes. The YAML editor beside this form, always in
                 sync, is where an order that matters to a reader can be set. -->
            <Button
                variant="text"
                iconType="full"
                aria-label={t("actionRemove")}
                onclick={() => remove(index)}
            >
                <Icon name="close" size="sm" />
            </Button>
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

    .hint {
        margin: 0;
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    /* A field is inline-flex and sizes to its own floor, so the row's stretch has to be applied to
       something outside it. */
    .field {
        display: flex;
        flex: 1;
        min-inline-size: 0;
    }
</style>
