<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        title: string;
        body?: string;
        auditId?: string;
        action?: Snippet;
    }

    const { title, body, auditId, action }: Props = $props();
</script>

<div class="empty" data-audit-id={auditId ?? "empty-state"} data-audit-column>
    <p class="title type-title">{title}</p>
    {#if body !== undefined}<p class="body type-body">{body}</p>{/if}
    {#if action !== undefined}<div class="action">{@render action()}</div>{/if}
</div>

<style>
    .empty {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-1);
        padding-block: var(--space-5);
        padding-inline: var(--space-4);
        border-radius: var(--radius-lg);
        background-color: rgb(var(--m3-scheme-surface-container-low));
    }

    .title {
        margin: 0;
        color: rgb(var(--m3-scheme-on-surface));
    }

    .body {
        margin: 0;
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .action {
        margin-block-start: var(--space-1);
    }
</style>
