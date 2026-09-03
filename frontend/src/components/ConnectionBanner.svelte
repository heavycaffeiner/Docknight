<script lang="ts">
    import { connectionState } from "../lib/connection.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";

    const disconnected = $derived(
        connectionState.value === "disconnected" || connectionState.value === "connecting"
    );
</script>

{#if disconnected}
    <aside class="gcp-banner" role="status" aria-live="polite" data-audit-clip>
        <span class="gcp-banner-dot" aria-hidden="true"></span>
        <span class="text-label gcp-banner-text">{t("connection.lost")}</span>
    </aside>
{/if}

<style>
    .gcp-banner {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        height: var(--size-control-sm);
        padding-inline: var(--space-4);
        background: var(--m3c-error-container);
        color: var(--m3c-on-error-container);
        font-weight: 500;
        font-size: 12px;
        z-index: 1000;
        flex-shrink: 0;
    }

    .gcp-banner-dot {
        width: var(--space-2);
        height: var(--space-2);
        border-radius: 50%;
        background: currentcolor;
        flex-shrink: 0;
    }

    .gcp-banner-text {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
