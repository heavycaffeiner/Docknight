<script lang="ts">
    import { t } from "../lib/stores/i18n.svelte.ts";

    interface Props {
        status: string;
    }

    let { status }: Props = $props();

    const normalized = $derived(status.toLowerCase());

    const label = $derived.by(() => {
        if (normalized === "running") return t("stack.status.running");
        if (normalized === "exited") return t("stack.status.exited");
        if (normalized === "created") return t("stack.status.created");
        if (normalized === "draft") return t("stack.status.draft");
        if (normalized === "healthy") return "Healthy";
        if (normalized === "unhealthy") return "Unhealthy";
        return status || t("stack.status.unknown");
    });

    const kind = $derived.by(() => {
        if (normalized === "running" || normalized === "healthy") return "success";
        if (normalized === "exited" || normalized === "unhealthy" || normalized === "dead") return "error";
        if (normalized === "created" || normalized === "starting") return "info";
        if (normalized === "draft") return "draft";
        return "neutral";
    });
</script>

<div class="gcp-status-chip {kind}" data-audit-id="status-chip" data-audit-row="center">
    <span class="gcp-status-dot" aria-hidden="true"></span>
    <span class="text-label gcp-status-text">{label}</span>
</div>

<style>
    .gcp-status-chip {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);

        /* A chip is a label, not a target: it keeps one compact height rather than following
           the coarse-pointer control size, which would stretch it into an oval on a phone. */
        height: var(--size-control-sm);
        padding-inline: var(--space-3);
        border-radius: var(--radius-round);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        white-space: nowrap;
        user-select: none;
    }

    .gcp-status-dot {
        width: var(--space-2);
        height: var(--space-2);
        border-radius: var(--radius-round);
        background: currentcolor;
        flex-shrink: 0;
    }

    .gcp-status-chip.success {
        background: #e6f4ea;
        color: #137333;
        box-shadow: inset 0 0 0 1px #ceead6;
    }

    .gcp-status-chip.error {
        background: #fce8e6;
        color: #c5221f;
        box-shadow: inset 0 0 0 1px #fad2cf;
    }

    .gcp-status-chip.info {
        background: #e8f0fe;
        color: #174ea6;
        box-shadow: inset 0 0 0 1px #d2e3fc;
    }

    .gcp-status-chip.draft {
        background: #fef7e0;
        color: #b06000;
        box-shadow: inset 0 0 0 1px #feefc3;
    }

    :global([data-theme="dark"]) .gcp-status-chip.success {
        background: #0f2c1b;
        color: #81c995;
        box-shadow: inset 0 0 0 1px #1e4620;
    }

    :global([data-theme="dark"]) .gcp-status-chip.error {
        background: #3c1211;
        color: #f28b82;
        box-shadow: inset 0 0 0 1px #5c1d1a;
    }

    :global([data-theme="dark"]) .gcp-status-chip.info {
        background: #172b4d;
        color: #8ab4f8;
        box-shadow: inset 0 0 0 1px #284477;
    }

    :global([data-theme="dark"]) .gcp-status-chip.draft {
        background: #3e2704;
        color: #fdd663;
        box-shadow: inset 0 0 0 1px #664106;
    }

    .gcp-status-text {
        font-weight: 500;
    }
</style>
