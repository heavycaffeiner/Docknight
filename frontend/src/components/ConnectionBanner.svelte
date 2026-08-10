<script lang="ts">
    import Icon from "./Icon.svelte";
    import { connection } from "../lib/connection.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";

    /**
     * Layered above the content whenever the socket is not open after a first successful connect.
     * It does not block interaction, because a compose file being edited must not be lost to a
     * five second network blip.
     */
    const visible = $derived(connection.everConnected && connection.state !== "connected");
</script>

{#if visible}
    <div class="banner" role="status" aria-live="polite" data-audit-id="connection-banner" data-audit-row="center">
        <Icon name="warning" size="sm" />
        <span class="text">
            {connection.state === "connecting"
                ? t("connectionConnecting")
                : connection.retryIn > 0
                  ? t("connectionRetryIn", { seconds: connection.retryIn })
                  : t("connectionLost")}
        </span>
    </div>
{/if}

<style>
    .banner {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        block-size: var(--size-control-md);
        padding-inline: var(--space-4);
        background-color: rgb(var(--m3-scheme-tertiary-container));
        color: rgb(var(--m3-scheme-on-tertiary-container));
    }

    .text {
        font-size: 0.875rem;
        line-height: var(--size-line-body-medium);
    }
</style>
