<script lang="ts">
    import { toasts, dismissToast } from "../lib/stores/toast.svelte.ts";
</script>

<aside class="gcp-toast-container" aria-label="Notifications">
    {#each toasts as toast (toast.id)}
        <div
            class="gcp-toast {toast.kind}"
            role={toast.kind === "error" ? "alert" : "status"}
            aria-live={toast.kind === "error" ? "assertive" : "polite"}
            data-audit-row="center"
        >
            <span class="text-body-medium gcp-toast-message">{toast.message}</span>
            <button
                type="button"
                class="gcp-toast-close"
                aria-label="Dismiss"
                onclick={() => dismissToast(toast.id)}
            >
                ✕
            </button>
        </div>
    {/each}
</aside>

<style>
    .gcp-toast-container {
        position: fixed;
        inset-inline-end: var(--space-4);
        inset-block-end: var(--space-4);
        z-index: 3000;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        max-width: var(--measure-form);
        pointer-events: none;
    }

    @media (width < 600px) {
        .gcp-toast-container {
            inset-block-end: calc(var(--space-4) + var(--size-bottom-bar));
        }
    }

    .gcp-toast {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        padding-block: var(--space-2);
        padding-inline: var(--space-4);
        border-radius: var(--radius-xs);
        background: #323232;
        color: #fff;
        box-shadow: 0 3px 8px rgb(0 0 0 / 25%);
        pointer-events: auto;
    }

    .gcp-toast.error {
        background: #d93025;
        color: #fff;
    }

    .gcp-toast.success {
        background: #188038;
        color: #fff;
    }

    .gcp-toast-message {
        color: inherit;
    }

    .gcp-toast-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-sm);
        height: var(--size-control-sm);
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        opacity: 0.8;
    }

    .gcp-toast-close:hover {
        opacity: 1;
    }
</style>
