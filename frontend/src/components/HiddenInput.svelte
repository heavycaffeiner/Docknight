<script lang="ts">
    import { t } from "../lib/stores/i18n.svelte.ts";

    interface Props {
        value: string;
        id?: string;
        autocomplete?: string;
    }

    let { value = $bindable(), id, autocomplete }: Props = $props();
    let revealed = $state(false);
</script>

<div class="wrap">
    <input
        {id}
        type={revealed ? "text" : "password"}
        bind:value
        autocomplete={autocomplete as "current-password" | "new-password" | undefined}
    />
    <button
        type="button"
        class="toggle"
        aria-label={revealed ? t("password.hide") : t("password.show")}
        aria-pressed={revealed}
        onclick={() => (revealed = !revealed)}
    >
        {revealed ? "🙈" : "👁"}
    </button>
</div>

<style>
    .wrap {
        position: relative;
        display: flex;
        min-width: 0;
    }

    input {
        flex: 1;
        min-width: 0;
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        padding-inline-end: var(--size-control-md);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
    }

    .toggle {
        position: absolute;
        inset-inline-end: 0;
        inset-block: 0;
        width: var(--size-control-md);
        border: none;
        background: transparent;
        cursor: pointer;
    }
</style>
