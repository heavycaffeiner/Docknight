<script lang="ts">
    import { LoadingIndicator } from "m3-svelte";
    import { t } from "../lib/stores/i18n.svelte.ts";

    /**
     * The one busy indicator. m3-svelte draws the shape and nothing else, so the progressbar role
     * and the accessible name are supplied here rather than at each call site.
     */
    interface Props {
        /** Caption, and the accessible name. Defaults to the generic loading string. */
        label?: string;
        /** `sm` shares a panel with other content; `md` holds a pane on its own. */
        size?: "sm" | "md";
        auditId?: string;
    }

    const { label, size = "md", auditId }: Props = $props();

    const text = $derived(label ?? t("loading"));
</script>

<div class="loading" data-audit-id={auditId} data-audit-row="center">
    <span class="shape" role="progressbar" aria-label={text}>
        <LoadingIndicator size={size === "sm" ? 24 : 48} center={false} />
    </span>
    <p class="caption type-body">{text}</p>
</div>

<style>
    .loading {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .shape {
        display: flex;
        color: rgb(var(--m3-scheme-primary));
    }

    .caption {
        margin: 0;
    }
</style>
