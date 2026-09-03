<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
    import { trapFocus } from "../lib/a11y.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";

    export interface MenuItemSpec {
        label: string;
        danger?: boolean;
        onSelect: () => void;
    }

    interface Props {
        items: MenuItemSpec[];
        label?: string;
    }

    let { items, label }: Props = $props();

    let open = $state(false);
    const compactQuery = new MediaQuery("width < 600px");
    let anchorEl = $state<HTMLElement | null>(null);
    let popupEl = $state<HTMLElement | null>(null);
    let flipAbove = $state(false);

    $effect(() => {
        if (open && !compactQuery.current && anchorEl !== null) {
            const anchorRect = anchorEl.getBoundingClientRect();
            const popupHeight = popupEl?.offsetHeight ?? 240;
            flipAbove = anchorRect.bottom + popupHeight > window.innerHeight;
        }
    });

    $effect(() => {
        if (open && popupEl !== null) {
            const release = trapFocus(popupEl);
            return release;
        }
    });

    function select(item: MenuItemSpec): void {
        open = false;
        item.onSelect();
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") open = false;
    }
</script>

<button
    bind:this={anchorEl}
    type="button"
    class="gcp-menu-trigger"
    aria-label={label ?? t("action.more")}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
>
    ⋮
</button>

{#if open}
    {#if compactQuery.current}
        <div class="gcp-backdrop" role="presentation" onclick={() => (open = false)}></div>
        <div
            bind:this={popupEl}
            class="gcp-sheet"
            role="menu"
            tabindex="-1"
            aria-label={label ?? t("action.more")}
            onkeydown={onKeydown}
        >
            {#each items as item (item.label)}
                <button
                    type="button"
                    class="gcp-sheet-item text-body-large"
                    class:danger={item.danger}
                    role="menuitem"
                    onclick={() => select(item)}
                >
                    {item.label}
                </button>
            {/each}
        </div>
    {:else}
        <div class="gcp-backdrop" role="presentation" onclick={() => (open = false)}></div>
        <div
            bind:this={popupEl}
            class="gcp-popup"
            class:above={flipAbove}
            role="menu"
            tabindex="-1"
            aria-label={label ?? t("action.more")}
            onkeydown={onKeydown}
        >
            {#each items as item (item.label)}
                <button
                    type="button"
                    class="gcp-popup-item text-body-medium"
                    class:danger={item.danger}
                    role="menuitem"
                    onclick={() => select(item)}
                >
                    {item.label}
                </button>
            {/each}
        </div>
    {/if}
{/if}

<style>
    .gcp-menu-trigger {
        width: var(--size-control-md);
        height: var(--size-control-md);
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--m3c-on-surface-variant);
        cursor: pointer;
        font-size: 18px;
    }

    .gcp-menu-trigger:hover {
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
    }

    .gcp-backdrop {
        position: fixed;
        inset: 0;
        z-index: 100;
    }

    .gcp-popup {
        position: fixed;
        inset-inline-end: var(--space-4);
        inset-block-start: var(--space-16);
        z-index: 101;
        display: flex;
        flex-direction: column;
        min-width: var(--measure-menu);
        padding-block: var(--space-2);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant), 0 4px 16px rgb(0 0 0 / 28%);
    }

    .gcp-popup.above {
        inset-block: auto var(--space-16);
    }

    .gcp-popup-item {
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        border: none;
        background: transparent;
        color: var(--m3c-on-surface);
        text-align: start;
        cursor: pointer;
        font-size: 13px;
        border-radius: var(--radius-xs);
    }

    .gcp-popup-item:hover {
        background: var(--m3c-surface-container-highest);
    }

    .gcp-popup-item.danger {
        color: var(--m3c-error);
    }

    .gcp-sheet {
        position: fixed;
        inset-inline: 0;
        inset-block-end: 0;
        z-index: 101;
        display: flex;
        flex-direction: column;
        padding-block: var(--space-2);
        border-start-start-radius: var(--radius-lg);
        border-start-end-radius: var(--radius-lg);
        border-block-start: 1px solid var(--m3c-outline-variant);
        background: var(--m3c-surface-container);
        box-shadow: 0 -4px 16px rgb(0 0 0 / 30%);
    }

    .gcp-sheet-item {
        height: var(--size-control-lg);
        padding-inline: var(--space-4);
        border: none;
        background: transparent;
        color: var(--m3c-on-surface);
        text-align: start;
        cursor: pointer;
        font-size: 14px;
    }

    .gcp-sheet-item:hover {
        background: var(--m3c-surface-container-highest);
    }

    .gcp-sheet-item.danger {
        color: var(--m3c-error);
    }
</style>
