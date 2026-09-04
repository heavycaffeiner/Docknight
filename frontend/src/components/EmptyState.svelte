<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        message: string;
        actionLabel?: string;
        actionHref?: string;
        onaction?: () => void;
        icon?: Snippet;
    }

    let { message, actionLabel, actionHref, onaction, icon }: Props = $props();
</script>

<div class="gcp-empty-state" data-audit-column>
    {#if icon}
        <div class="gcp-empty-icon" aria-hidden="true" data-audit-opaque>
            {@render icon()}
        </div>
    {:else}
        <div class="gcp-empty-icon" aria-hidden="true" data-audit-opaque>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="gcp-empty-svg">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
        </div>
    {/if}
    <p class="text-body-large gcp-empty-message">{message}</p>
    {#if actionLabel}
        {#if actionHref}
            <a href={actionHref} class="gcp-empty-action text-label" onclick={onaction}>{actionLabel}</a>
        {:else if onaction}
            <button type="button" class="gcp-empty-action text-label" onclick={onaction}>{actionLabel}</button>
        {/if}
    {/if}
</div>

<style>
    .gcp-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding-block: var(--space-16);
        padding-inline: var(--space-4);
        text-align: center;
        gap: var(--space-3);
    }

    .gcp-empty-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-xl);
        height: var(--size-control-xl);
        border-radius: var(--radius-xl);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface-variant);
    }

    .gcp-empty-svg {
        width: var(--size-icon-lg);
        height: var(--size-icon-lg);
    }

    .gcp-empty-message {
        color: var(--m3c-on-surface-variant);
        max-width: var(--measure-form);
    }

    .gcp-empty-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        border-radius: var(--radius-xs);
        border: none;
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        font-weight: 500;
        text-decoration: none;
        cursor: pointer;
    }

    .gcp-empty-action:hover {
        background: var(--m3c-primary-dim);
    }
</style>
