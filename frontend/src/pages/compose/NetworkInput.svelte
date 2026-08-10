<script lang="ts">
    import { Button } from "m3-svelte";
    import Icon from "../../components/Icon.svelte";
    import { t } from "../../lib/stores/i18n.svelte.ts";

    /**
     * Top-level networks. An entry is either internal, meaning an empty mapping compose creates,
     * or external, meaning a network that already exists on the host.
     */
    interface Props {
        networks: Record<string, unknown>;
        available: string[];
        editable: boolean;
        onchange: (next: Record<string, unknown> | undefined) => void;
    }

    const { networks, available, editable, onchange }: Props = $props();

    const entries = $derived(Object.entries(networks));

    function isExternal(value: unknown): boolean {
        return (
            value !== null &&
            typeof value === "object" &&
            (value as { external?: unknown }).external === true
        );
    }

    function setExternal(name: string, external: boolean): void {
        onchange({ ...networks, [name]: external ? { external: true } : null });
    }

    function rename(from: string, to: string): void {
        if (to === "" || (to !== from && networks[to] !== undefined)) return;
        const next: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(networks)) next[key === from ? to : key] = value;
        onchange(next);
    }

    function remove(name: string): void {
        const next = { ...networks };
        delete next[name];
        onchange(Object.keys(next).length === 0 ? undefined : next);
    }

    function add(): void {
        let candidate = "network";
        let index = 1;
        while (networks[candidate] !== undefined) {
            index += 1;
            candidate = `network-${index}`;
        }
        onchange({ ...networks, [candidate]: null });
    }
</script>

<section class="block" data-audit-id="network-input" data-audit-column>
    <h3 class="type-title">{t("stackNetworks")}</h3>
    {#each entries as [name, value] (name)}
        <div class="row" data-audit-row="center">
            {#if editable}
                <input
                    class="input type-mono"
                    type="text"
                    value={name}
                    aria-label={t("networksPlaceholder")}
                    list="docknight-networks"
                    onchange={(event) => rename(name, event.currentTarget.value.trim())}
                />
                <label class="external" data-audit-row="center">
                    <input
                        type="checkbox"
                        checked={isExternal(value)}
                        onchange={(event) => setExternal(name, event.currentTarget.checked)}
                    />
                    <span class="type-label">{t("networkExternal")}</span>
                </label>
                <button
                    type="button"
                    class="icon-button"
                    aria-label={t("actionRemove")}
                    onclick={() => remove(name)}
                >
                    <Icon name="close" size="sm" />
                </button>
            {:else}
                <span class="type-mono">{name}</span>
                {#if isExternal(value)}
                    <span class="tag pill type-label">{t("networkExternal")}</span>
                {/if}
            {/if}
        </div>
    {/each}

    {#if editable}
        <datalist id="docknight-networks">
            {#each available as network (network)}
                <option value={network}></option>
            {/each}
        </datalist>
        <div class="add">
            <Button variant="text" iconType="left" onclick={add}>
                <Icon name="add" size="md" />
                {t("networkAdd")}
            </Button>
        </div>
    {/if}
</section>

<style>
    .block {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        padding: var(--space-4);
        border-radius: var(--radius-lg);
        background-color: rgb(var(--m3-scheme-surface-container-low));
    }

    h3 {
        margin: 0;
    }

    .row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-block-size: var(--size-control-md);
    }

    .input {
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

    .external {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-block-size: var(--size-control-md);
        color: rgb(var(--m3-scheme-on-surface-variant));
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

    .tag {
        background-color: rgb(var(--m3-scheme-surface-container-high));
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .add {
        display: flex;
        justify-content: flex-start;
    }
</style>
