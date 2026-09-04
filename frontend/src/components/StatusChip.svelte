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
    <span class="gcp-status-text">{label}</span>
</div>

<style>
    .gcp-status-chip {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);

        /* M3 chip: 32dp container, CornerSmall (8dp) shape, 1dp outline, labelLarge text. A
           chip is a label rather than a target, so it keeps this height under a coarse pointer
           instead of growing to the 48dp control size. */
        height: var(--chip-height);
        padding-inline: var(--chip-padding-inline);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: transparent;
        color: var(--m3c-on-surface-variant);
        font-size: var(--control-font-size);
        line-height: var(--space-5);
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

    /*
     * Each status keeps its own hue rather than taking a theme colour, because the state it
     * reports is the point. light-dark() carries both schemes in one declaration, so a status
     * cannot pick up the wrong pair when only one branch is edited.
     */
    .gcp-status-chip.success {
        background: light-dark(#e6f4ea, #0f2c1b);
        color: light-dark(#137333, #81c995);
        border-color: light-dark(#ceead6, #1e4620);
    }

    .gcp-status-chip.error {
        background: light-dark(#fce8e6, #3c1211);
        color: light-dark(#c5221f, #f28b82);
        border-color: light-dark(#fad2cf, #5c1d1a);
    }

    .gcp-status-chip.info {
        background: light-dark(#e8f0fe, #172b4d);
        color: light-dark(#174ea6, #8ab4f8);
        border-color: light-dark(#d2e3fc, #284477);
    }

    .gcp-status-chip.draft {
        background: light-dark(#fef7e0, #3e2704);
        color: light-dark(#b06000, #fdd663);
        border-color: light-dark(#feefc3, #664106);
    }

    /* labelLarge, matching md-assist-chip: 14px / 500 / 20px. The chip container sets the size
       and line height, so the label only needs the weight. */
    .gcp-status-text {
        font-weight: 500;
    }
</style>
