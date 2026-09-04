<script lang="ts">
    import { connectionState } from "../lib/connection.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
</script>

{#if connectionState.degraded}
    <div class="gcp-connection-banner" role="status" aria-live="polite" data-audit-row="center">
        <span class="gcp-banner-dot" aria-hidden="true"></span>
        <span class="text-label gcp-banner-text">{t("connection.degraded")}</span>
    </div>
{/if}

<style>
    .gcp-connection-banner {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        background: #fef7e0;
        color: #b06000;
        border-block-end: 1px solid #feefc3;
        font-weight: 500;
        z-index: 100;
    }

    :global([data-theme="dark"]) .gcp-connection-banner {
        background: #3e2704;
        color: #fdd663;
        border-block-end: 1px solid #664106;
    }

    .gcp-banner-dot {
        width: var(--space-2);
        height: var(--space-2);
        border-radius: var(--radius-xl);
        background: currentcolor;
    }
</style>
