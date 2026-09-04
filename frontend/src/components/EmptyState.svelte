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
            <svg viewBox="0 0 24 24" class="gcp-empty-svg" aria-hidden="true" data-audit-opaque>
                <defs>
                    <linearGradient id="gcp-gemini-empty" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#4285f4" />
                        <stop offset="50%" stop-color="#9b72cb" />
                        <stop offset="100%" stop-color="#d96570" />
                    </linearGradient>
                </defs>
                <path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z" fill="url(#gcp-gemini-empty)" />
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
        border-radius: var(--radius-round);
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
