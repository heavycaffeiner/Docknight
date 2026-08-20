<script lang="ts">
    import { degraded } from "../lib/connection.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
</script>

{#if degraded.value}
    <div class="banner" role="status" data-audit-id="connection-banner">
        <span class="text-body-medium">{t("connection.degraded")}</span>
    </div>
{/if}

<style>
    .banner {
        position: sticky;
        inset-block-start: 0;
        z-index: 50;
        padding: var(--space-2) var(--space-4);
        background: var(--m3c-tertiary-container);
        color: var(--m3c-on-tertiary-container);
        text-align: center;
    }
</style>
