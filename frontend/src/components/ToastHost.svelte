<script lang="ts">
    import { toasts, dismiss } from "../lib/stores/toast.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
</script>

<div class="gcp-toast-host" aria-live="polite">
    {#each toasts.list as toast (toast.id)}
        <div class="gcp-toast {toast.variant}" role="alert">
            <span class="gcp-toast-message text-body-medium">{toast.message}</span>
            <button
                type="button"
                class="gcp-toast-close"
                aria-label={t("action.discard")}
                onclick={() => dismiss(toast.id)}
            >
                ✕
            </button>
        </div>
    {/each}
</div>

<style>
    .gcp-toast-host {
        position: fixed;
        inset-inline-end: var(--space-4);
        inset-block-end: var(--space-4);
        z-index: 2000;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        pointer-events: none;
        max-width: var(--measure-form);
    }

    .gcp-toast {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding-block: var(--space-2);
        padding-inline: var(--space-3);
        border-radius: var(--radius-xs);
        background: var(--m3c-inverse-surface);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant), 0 4px 16px rgb(0 0 0 / 30%);
        color: var(--m3c-inverse-on-surface);
        pointer-events: auto;
    }

    .gcp-toast.error {
        box-shadow: inset 3px 0 0 var(--m3c-error), inset 0 0 0 1px var(--m3c-outline-variant), 0 4px 16px rgb(0 0 0 / 30%);
    }

    .gcp-toast-message {
        flex: 1;
        overflow-wrap: anywhere;
    }

    .gcp-toast-close {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-sm);
        height: var(--size-control-sm);
        border: none;
        border-radius: var(--radius-xs);
        background: transparent;
        color: var(--m3c-inverse-on-surface);
        font-size: 14px;
        cursor: pointer;
        opacity: 0.8;
    }

    .gcp-toast-close:hover {
        opacity: 1;
        background: rgb(255 255 255 / 10%);
    }
</style>
