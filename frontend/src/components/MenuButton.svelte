<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
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

    let { items, label = t("action.more") }: Props = $props();

    const isMedium = new MediaQuery("width >= 600px");
    let open = $state(false);
    function toggleMenu(): void {
        open = !open;
    }

    function closeMenu(): void {
        open = false;
    }

    function handleSelect(item: MenuItemSpec): void {
        closeMenu();
        item.onSelect();
    }

    function onKeydown(event: KeyboardEvent): void {
        if (!open) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closeMenu();
        }
    }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="gcp-menu-container">
    <button
        type="button"
        class="gcp-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onclick={toggleMenu}
    >
        <svg
            class="gcp-dots"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            data-audit-opaque
        >
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
        </svg>
    </button>

    {#if open}
        <div class="gcp-menu-backdrop" role="presentation" onclick={closeMenu}></div>

        {#if isMedium.current}
            <div
                class="gcp-menu-popup"
                role="menu"
                data-audit-column
            >
                {#each items as item (item.label)}
                    <button
                        type="button"
                        role="menuitem"
                        class="gcp-menu-item"
                        class:danger={item.danger}
                        onclick={() => handleSelect(item)}
                    >
                        {item.label}
                    </button>
                {/each}
            </div>
        {:else}
            <div class="gcp-menu-sheet" role="menu" data-audit-column>
                <div class="gcp-sheet-handle" aria-hidden="true"></div>
                {#each items as item (item.label)}
                    <button
                        type="button"
                        role="menuitem"
                        class="gcp-sheet-item text-label"
                        class:danger={item.danger}
                        onclick={() => handleSelect(item)}
                    >
                        {item.label}
                    </button>
                {/each}
            </div>
        {/if}
    {/if}
</div>

<style>
    .gcp-menu-container {
        position: relative;
        display: inline-flex;
    }

    .gcp-menu-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-md);
        height: var(--size-control-md);
        padding: 0;
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        cursor: pointer;
    }

    .gcp-dots {
        display: block;
        width: var(--size-icon-sm);
        height: var(--size-icon-sm);
    }

    .gcp-menu-trigger:hover {
        background: var(--m3c-surface-container-highest);
    }

    @media (pointer: coarse) {
        .gcp-menu-trigger {
            width: var(--size-control-lg);
            height: var(--size-control-lg);
        }
    }

    .gcp-menu-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: transparent;
    }

    .gcp-menu-popup {
        position: absolute;
        inset-block-start: 100%;
        inset-inline-end: 0;
        margin-block-start: var(--space-1);
        z-index: 1001;
        width: var(--measure-menu);
        border-radius: var(--radius-xs);
        border: 1px solid var(--m3c-outline-variant);
        background: var(--m3c-surface-container-high);
        box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
        display: flex;
        flex-direction: column;
    }

    .gcp-menu-item {
        display: flex;
        align-items: center;
        width: 100%;
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        border: none;
        background: transparent;
        color: var(--m3c-on-surface);
        text-align: start;
        font-size: 13px;
        cursor: pointer;
    }

    .gcp-menu-item:hover {
        background: var(--m3c-surface-container-highest);
    }

    .gcp-menu-item.danger {
        color: var(--m3c-error);
    }

    .gcp-menu-sheet {
        position: fixed;
        inset-inline: 0;
        inset-block-end: 0;
        z-index: 1001;
        display: flex;
        flex-direction: column;
        padding-block-end: var(--space-4);
        border-block-start: 1px solid var(--m3c-outline-variant);
        border-start-start-radius: var(--radius-md);
        border-start-end-radius: var(--radius-md);
        background: var(--m3c-surface-container-high);
        box-shadow: 0 -4px 16px rgb(0 0 0 / 20%);
    }

    .gcp-sheet-handle {
        align-self: center;
        width: var(--space-8);
        height: var(--space-1);
        margin-block: var(--space-2);
        border-radius: var(--radius-xl);
        background: var(--m3c-outline-variant);
    }

    .gcp-sheet-item {
        display: flex;
        align-items: center;
        width: 100%;
        height: var(--size-control-lg);
        padding-inline: var(--space-6);
        border: none;
        background: transparent;
        color: var(--m3c-on-surface);
        text-align: start;
        font-size: 14px;
        cursor: pointer;
    }

    .gcp-sheet-item:hover {
        background: var(--m3c-surface-container-highest);
    }

    .gcp-sheet-item.danger {
        color: var(--m3c-error);
    }
</style>
