<script lang="ts">
    import type { Snippet } from "svelte";

    /**
     * The one badge in the application. Every tag, host label, port and status pill is this, so a
     * row that mixes them shares a single centre axis. The box matches the Material chip it sits
     * next to: 32px tall, small shape, hairline edge.
     *
     * Not interactive by design. A badge that acts on click is a Chip from m3-svelte instead, which
     * is also why it keeps its height under a coarse pointer: a label drawn the size of a button
     * reads as a button, and there is nothing here to press.
     */
    interface Props {
        tone?: "neutral" | "good" | "bad" | "wait" | "draft" | "quiet";
        /** Draws the state dot, so status is carried by shape as well as by colour. */
        dot?: boolean;
        auditId?: string;
        children: Snippet;
    }

    const { tone = "quiet", dot = false, auditId, children }: Props = $props();
</script>

<span class="badge tone-{tone}" data-audit-id={auditId}>
    {#if dot}<span class="dot" aria-hidden="true"></span>{/if}
    <span class="label">{@render children()}</span>
</span>

<style>
    .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        block-size: var(--size-control-sm);
        padding-inline: var(--space-3);
        border-radius: var(--radius-sm);
        box-shadow: inset 0 0 0 var(--hairline) rgb(var(--m3-scheme-outline-variant));
        white-space: nowrap;
        transition:
            background-color var(--m3-util-easing),
            color var(--m3-util-easing);
    }

    .label {
        font-size: 0.75rem;
        line-height: var(--size-line-label);
        font-weight: 500;
        letter-spacing: 0.02em;
    }

    .dot {
        inline-size: var(--space-2);
        block-size: var(--space-2);
        border-radius: var(--radius-full);
        background-color: currentcolor;
    }

    .tone-good {
        background-color: rgb(var(--m3-scheme-primary-container));
        color: rgb(var(--m3-scheme-on-primary-container));
    }

    .tone-bad {
        background-color: rgb(var(--m3-scheme-error-container));
        color: rgb(var(--m3-scheme-on-error-container));
    }

    .tone-wait {
        background-color: rgb(var(--m3-scheme-tertiary-container));
        color: rgb(var(--m3-scheme-on-tertiary-container));
    }

    .tone-neutral {
        background-color: rgb(var(--m3-scheme-surface-container-high));
        color: rgb(var(--m3-scheme-on-surface));
    }

    .tone-draft {
        background-color: rgb(var(--m3-scheme-surface-container));
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    /* No fill, so it reads as an annotation on whatever surface it lands on. */
    .tone-quiet {
        color: rgb(var(--m3-scheme-on-surface-variant));
    }
</style>
