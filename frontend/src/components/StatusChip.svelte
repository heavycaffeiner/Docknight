<script lang="ts">
    import Badge from "./Badge.svelte";
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

    type Tone = "good" | "bad" | "wait" | "neutral" | "draft";

    const SERVICE_TONE: Record<string, Tone> = {
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

    const tone = $derived.by((): Tone => {
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

<Badge {tone} dot auditId={auditId ?? "status-chip"}>{label}</Badge>
