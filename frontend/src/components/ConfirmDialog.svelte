<script lang="ts">
    import type { Snippet } from "svelte";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { keyboardOpen } from "../lib/viewport.svelte.ts";

    interface Props {
        open: boolean;
        title: string;
        message?: string;
        confirmLabel?: string;
        cancelLabel?: string;
        danger?: boolean;
        onconfirm: () => void;
        oncancel: () => void;
        children?: Snippet;
    }

    let {
        open,
        title,
        message,
        confirmLabel = t("action.confirm"),
        cancelLabel = t("action.cancel"),
        danger = false,
        onconfirm,
        oncancel,
        children,
    }: Props = $props();

    let dialogElement = $state<HTMLDivElement | null>(null);

    function onKeydown(event: KeyboardEvent): void {
        if (!open) return;
        if (event.key === "Escape") {
            event.preventDefault();
            oncancel();
        }
    }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
    <div
        class="gcp-dialog-backdrop"
        class:keyboard-offset={keyboardOpen.value}
        role="presentation"
        onclick={(e) => {
            if (e.target === e.currentTarget) oncancel();
        }}
    >
        <div
            bind:this={dialogElement}
            class="gcp-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            data-audit-column
        >
            <div class="gcp-dialog-header" data-audit-row="center">
                <h2 id="dialog-title" class="text-title">{title}</h2>
            </div>

            <div class="gcp-dialog-body" data-audit-column>
                {#if message}
                    <p class="text-body-medium gcp-dialog-message">{message}</p>
                {/if}
                {#if children}
                    {@render children()}
                {/if}
            </div>

            <div class="gcp-dialog-actions" data-audit-row="center">
                <button type="button" class="gcp-dialog-btn cancel" onclick={oncancel}>
                    {cancelLabel}
                </button>
                <button
                    type="button"
                    class="gcp-dialog-btn confirm"
                    class:danger
                    onclick={onconfirm}
                >
                    {confirmLabel}
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .gcp-dialog-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--space-4);
        background: rgb(0 0 0 / 50%);
        backdrop-filter: blur(2px);
    }

    .gcp-dialog-backdrop.keyboard-offset {
        align-items: flex-start;
        padding-block-start: var(--space-8);
    }

    .gcp-dialog {
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: var(--measure-form);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        border-radius: var(--radius-lg);
        border: 1px solid var(--m3c-outline-variant);
        box-shadow: var(--shadow-overlay);
        overflow: hidden;
    }

    .gcp-dialog-header {
        display: flex;
        align-items: center;
        padding: var(--space-4);
        border-block-end: 1px solid var(--m3c-outline-variant);
    }

    .gcp-dialog-body {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        padding: var(--space-4);
    }

    .gcp-dialog-message {
        color: var(--m3c-on-surface-variant);
    }

    .gcp-dialog-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--space-2);
        padding: var(--space-3) var(--space-4);
        background: var(--m3c-surface-container);
        border-block-start: 1px solid var(--m3c-outline-variant);
    }

    .gcp-dialog-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: var(--size-control-md);
        padding-inline: var(--space-5);
        border-radius: var(--radius-sm);
        border: 1px solid var(--m3c-outline-variant);
        background: transparent;
        color: var(--m3c-on-surface);
        font-weight: 500;
        font-size: 14px;
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease-standard);
    }

    .gcp-dialog-btn.cancel:hover {
        background: var(--m3c-surface-container-highest);
    }

    .gcp-dialog-btn.confirm {
        border-color: transparent;
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
    }

    .gcp-dialog-btn.confirm:hover {
        background: var(--m3c-primary-dim);
    }

    .gcp-dialog-btn.confirm.danger {
        background: var(--m3c-error);
        color: var(--m3c-on-error);
    }

    .gcp-dialog-btn.confirm.danger:hover {
        background: var(--m3c-error-container);
    }
</style>
