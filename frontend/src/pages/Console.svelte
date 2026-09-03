<script lang="ts">
    import { request } from "../lib/connection.svelte.ts";
    import { session } from "../lib/stores/session.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import TerminalView from "../components/TerminalView.svelte";

    let consoleEnabled = $state<boolean | null>(null);

    $effect(() => {
        if (session.state === "authenticated") {
            request("", "terminal.mainEnabled", undefined)
                .then((result) => {
                    consoleEnabled = result.enabled;
                })
                .catch(() => {
                    consoleEnabled = false;
                });
        }
    });
</script>

<div class="gcp-console-page" data-audit-root data-grid-origin>
    <div class="gcp-console-header" data-audit-row="center">
        <h1 class="text-headline">{t("nav.console")}</h1>
        <span class="gcp-env-chip text-label" data-audit-clip>Cloud Shell</span>
    </div>

    {#if consoleEnabled === false}
        <div class="gcp-console-disabled" data-audit-column>
            <p class="text-body-large">{t("console.disabled")}</p>
        </div>
    {:else if consoleEnabled === true}
        <div class="gcp-console-frame" data-audit-column data-grid-origin>
            <TerminalView endpoint="" terminal="main" interactive={true} rows={32} />
        </div>
    {/if}
</div>

<style>
    .gcp-console-page {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        padding: var(--space-4);
        block-size: 100%;
        min-height: 0;
    }

    .gcp-console-header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        height: var(--size-control-lg);
    }

    .gcp-env-chip {
        display: inline-flex;
        align-items: center;
        height: var(--size-control-sm);
        padding-inline: var(--space-2);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-high);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        color: var(--m3c-on-surface-variant);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
    }

    .gcp-console-disabled {
        padding: var(--space-6);
        border-radius: var(--radius-md);
        background: var(--m3c-surface-container-low);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        color: var(--m3c-on-surface-variant);
    }

    .gcp-console-frame {
        flex: 1;
        min-height: var(--measure-editor-lg);
        display: flex;
        flex-direction: column;
    }
</style>
