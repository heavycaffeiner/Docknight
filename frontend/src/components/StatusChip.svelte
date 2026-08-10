<script lang="ts">
    import { CREATED, DRAFT, EXITED, RUNNING, statusKey, type StackStatus } from "$common/stack.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";

    /**
     * Status is never conveyed by colour alone: the chip always carries the word. `tone` is
     * derived from either a stack status number or a per-service status string.
     */
    interface Props {
        status?: StackStatus;
        service?: string;
        auditId?: string;
    }

    const { status, service, auditId }: Props = $props();

    const SERVICE_TONE: Record<string, string> = {
        running: "good",
        healthy: "good",
        unhealthy: "bad",
        starting: "wait",
        restarting: "wait",
        created: "neutral",
        paused: "neutral",
        exited: "bad",
        dead: "bad",
    };

    const tone = $derived.by(() => {
        if (service !== undefined) return SERVICE_TONE[service.toLowerCase()] ?? "neutral";
        switch (status) {
            case RUNNING:
                return "good";
            case EXITED:
                return "bad";
            case CREATED:
                return "neutral";
            case DRAFT:
                return "draft";
            default:
                return "neutral";
        }
    });

    const label = $derived.by(() => {
        if (service !== undefined) {
            const key = `service${service.charAt(0).toUpperCase()}${service.slice(1).toLowerCase()}`;
            const translated = t(key);
            return translated === key ? service : translated;
        }
        return t(statusKey(status ?? 0));
    });
</script>

<span class="chip tone-{tone}" data-audit-id={auditId ?? "status-chip"}>
    <span class="dot" aria-hidden="true"></span>
    <span class="text">{label}</span>
</span>

<style>
    /* Same block size as every other badge, so a chip and a tag on one row share a centre axis. */
    .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        block-size: var(--size-line-body);
        padding-inline: var(--space-2);
        border: 0;
        border-radius: var(--radius-full);
        /* The fill carries the state and the label names it, so the edge is only there to separate the
           chip from a row it happens to sit on. At the outline role it read as a heavy dark ring. */
        box-shadow: inset 0 0 0 var(--hairline) rgb(var(--m3-scheme-outline-variant));
        font-size: 0.75rem;
        line-height: var(--size-line-label);
        font-weight: 500;
        white-space: nowrap;
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
</style>
