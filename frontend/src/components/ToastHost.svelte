<script lang="ts">
    import { dismiss, toasts } from "../lib/stores/toast.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
</script>

<div class="host" data-audit-id="toast-host">
    {#each toasts.list as toast (toast.id)}
        <div
            class="toast {toast.variant}"
            role="status"
            aria-live={toast.variant === "error" ? "assertive" : "polite"}
        >
            <span class="text-body-medium">{toast.message}</span>
            <button type="button" class="dismiss" aria-label={t("action.close")} onclick={() => dismiss(toast.id)}>
                ✕
            </button>
        </div>
    {/each}
</div>

<style>
    .host {
        position: fixed;
        inset-block-end: var(--space-4);
        inset-inline-end: var(--space-4);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        z-index: 200;
        max-width: var(--measure-form);
    }

    /* The bottom bar occupies this band on compact screens, so toasts sit above it there. */
    :global(.shell:not([data-keyboard="open"]) .host) {
        inset-block-end: calc(var(--space-4) + var(--size-bottom-bar));
    }

    @media (width >= 600px) {
        .host {
            inset-block-end: var(--space-4);
        }
    }

    .toast {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-sm);
        box-shadow: 0 2px 6px rgb(0 0 0 / 24%);
    }

    .success {
        background: var(--m3c-inverse-surface);
        color: var(--m3c-inverse-on-surface);
    }

    .error {
        background: var(--m3c-error-container);
        color: var(--m3c-on-error-container);
    }

    .dismiss {
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        width: var(--size-icon-lg);
        height: var(--size-icon-lg);
    }
</style>
