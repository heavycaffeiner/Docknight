<script lang="ts">
    import { Button, SnackbarItem } from "m3-svelte";
    import { slide } from "svelte/transition";
    import Icon from "./Icon.svelte";
    import { arrive } from "../lib/motion.ts";
    import { dismiss, toasts, type Toast } from "../lib/stores/toast.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";

    /**
     * Two live regions rather than one: a result is polite and an error is assertive, and a single
     * region can only carry one of those.
     */
    const successes = $derived(toasts.items.filter((item) => item.variant === "success"));
    const errors = $derived(toasts.items.filter((item) => item.variant === "error"));
</script>

{#snippet item(toast: Toast)}
    <div
        class="slot"
        class:error={toast.variant === "error"}
        transition:slide={{ ...arrive(), axis: "y" }}
    >
        <SnackbarItem data-audit-id="toast" data-audit-row="center">
            <Icon name={toast.variant === "error" ? "warning" : "check"} size="sm" />
            <span class="text">{toast.text}</span>
            <Button
                variant="text"
                iconType="full"
                aria-label={t("actionDismiss")}
                onclick={() => dismiss(toast.id)}
            >
                <Icon name="close" size="sm" />
            </Button>
        </SnackbarItem>
    </div>
{/snippet}

<div class="host" data-audit-id="toast-host" data-audit-column>
    <div class="region" role="status" aria-live="polite">
        {#each successes as toast (toast.id)}
            {@render item(toast)}
        {/each}
    </div>
    <div class="region" role="alert" aria-live="assertive">
        {#each errors as toast (toast.id)}
            {@render item(toast)}
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

    .slot {
        pointer-events: auto;
    }

    /* The snackbar is 20rem wide at minimum, which is the whole of a 320 viewport and then some, so
       the floor is dropped and the host's own width bounds it instead. The action is tinted with the
       role Material reserves for it, since primary on an inverse surface is barely legible. */
    .slot > :global(.m3-container) {
        gap: var(--space-3);
        min-inline-size: 0;
        --m3-scheme-primary: var(--m3-scheme-inverse-primary);
    }

    .slot.error > :global(.m3-container) {
        background-color: rgb(var(--m3-scheme-error-container));
        color: rgb(var(--m3-scheme-on-error-container));
        --m3-scheme-primary: var(--m3-scheme-on-error-container);
    }

    .text {
        flex: 1;
        min-inline-size: 0;
        font-size: 0.875rem;
        line-height: var(--size-line-body-medium);
        overflow-wrap: anywhere;
    }
</style>
