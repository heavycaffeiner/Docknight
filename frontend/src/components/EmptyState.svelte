<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        message: string;
        action?: Snippet;
    }

    let { message, action }: Props = $props();
</script>

<div class="empty" data-audit-id="empty-state">
    <p class="text-body-large">{message}</p>
    {#if action}
        <div class="action">
            {@render action()}
        </div>
    {/if}
</div>

<style>
    .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-4);
        padding-block: var(--space-16);
        text-align: center;
        color: var(--m3c-on-surface-variant);
    }
</style>
