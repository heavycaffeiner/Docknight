<script lang="ts">
    import Icon from "./Icon.svelte";
    import { dismiss, toasts } from "../lib/stores/toast.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
</script>

<div class="host" data-audit-id="toast-host" data-audit-column>
    <div class="region" role="status" aria-live="polite">
        {#each toasts.items.filter((item) => item.variant === "success") as toast (toast.id)}
            <div class="toast success" data-audit-id="toast" data-audit-row="center">
                <Icon name="check" size="sm" />
                <span class="text">{toast.text}</span>
                <button
                    type="button"
                    class="dismiss"
                    aria-label={t("actionDismiss")}
                    onclick={() => dismiss(toast.id)}
                >
                    <Icon name="close" size="sm" />
                </button>
            </div>
        {/each}
    </div>
    <div class="region" role="alert" aria-live="assertive">
        {#each toasts.items.filter((item) => item.variant === "error") as toast (toast.id)}
            <div class="toast error" data-audit-id="toast" data-audit-row="center">
                <Icon name="warning" size="sm" />
                <span class="text">{toast.text}</span>
                <button
                    type="button"
                    class="dismiss"
                    aria-label={t("actionDismiss")}
                    onclick={() => dismiss(toast.id)}
                >
                    <Icon name="close" size="sm" />
                </button>
            </div>
        {/each}
    </div>
</div>

<style>
    .host {
        position: fixed;
        inset-block-end: var(--space-4);
        inset-inline-end: var(--space-4);
        z-index: 40;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        max-inline-size: var(--measure-form);
        pointer-events: none;
    }

    .region {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .toast {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        min-block-size: var(--size-control-lg);
        padding-inline: var(--space-4);
        padding-block: var(--space-3);
        border-radius: var(--radius-lg);
        box-shadow: var(--m3-util-elevation-2);
        pointer-events: auto;
    }

    .success {
        background-color: rgb(var(--m3-scheme-inverse-surface));
        color: rgb(var(--m3-scheme-inverse-on-surface));
    }

    .error {
        background-color: rgb(var(--m3-scheme-error-container));
        color: rgb(var(--m3-scheme-on-error-container));
    }

    .text {
        flex: 1;
        font-size: 0.875rem;
        line-height: var(--size-line-body-medium);
    }

    .dismiss {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: var(--size-control-sm);
        block-size: var(--size-control-sm);
        padding: 0;
        border: 0;
        border-radius: var(--radius-full);
        background: none;
        color: inherit;
        cursor: pointer;
    }

    .dismiss:hover {
        background-color: rgb(var(--m3-scheme-shadow) / 0.12);
    }
</style>
