<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        message: string;
        action?: Snippet;
    }

    let { message, action }: Props = $props();
</script>

<div class="gcp-empty-state" data-audit-column>
    <svg class="gcp-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
        <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
    <p class="text-body-medium gcp-empty-message">{message}</p>
    {#if action}
        <div class="gcp-empty-action">
            {@render action()}
        </div>
    {/if}
</div>

<style>
    .gcp-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding-block: var(--space-8);
        padding-inline: var(--space-4);
        text-align: center;
        gap: var(--space-3);
    }

    .gcp-empty-icon {
        width: var(--size-icon-lg);
        height: var(--size-icon-lg);
        color: var(--m3c-outline);
        opacity: 0.6;
    }

    .gcp-empty-message {
        color: var(--m3c-on-surface-variant);
        max-width: var(--measure-form);
    }

    .gcp-empty-action {
        display: flex;
        margin-block-start: var(--space-2);
    }
</style>
