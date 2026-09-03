<script lang="ts">
    import { t } from "../lib/stores/i18n.svelte.ts";

    interface Props {
        /** A service status string, or "unknown"/"draft"/"created"/"running"/"exited" for a stack. */
        status: string;
    }

    let { status }: Props = $props();

    const KNOWN_KEYS: Record<string, string> = {
        unknown: "stack.status.unknown",
        draft: "stack.status.draft",
        created: "stack.status.created",
        running: "stack.status.running",
        exited: "stack.status.exited",
    };

    const label = $derived(KNOWN_KEYS[status] !== undefined ? t(KNOWN_KEYS[status] as string) : status);

    const tone = $derived.by(() => {
        const lower = status.toLowerCase();
        if (lower === "running" || lower === "healthy") return "good";
        if (lower === "exited" || lower === "unhealthy") return "bad";
        if (lower === "starting" || lower === "restarting" || lower === "created") return "pending";
        return "neutral";
    });
</script>

<!--
  Colour never carries meaning alone: the word is always rendered alongside the colour.
-->
<span class="chip {tone}" data-audit-id="status-chip">
    <span class="dot" aria-hidden="true"></span>
    <span class="chip-text">{label}</span>
</span>

<style>
    .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        height: var(--size-control-sm);
        padding-inline: var(--space-2);
        border-radius: var(--radius-xl);
        font-size: 12px;
        line-height: var(--space-4);
        font-weight: 600;
        white-space: nowrap;
    }

    .dot {
        width: var(--space-2);
        height: var(--space-2);
        border-radius: 50%;
        background: currentcolor;
        flex-shrink: 0;
    }

    .good {
        background: var(--m3c-tertiary-container);
        color: var(--m3c-on-tertiary-container);
    }

    .bad {
        background: var(--m3c-error-container);
        color: var(--m3c-on-error-container);
    }

    .pending {
        background: var(--m3c-secondary-container);
        color: var(--m3c-on-secondary-container);
    }

    .neutral {
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface-variant);
    }
</style>
