<script lang="ts">
    import { t } from "../lib/stores/i18n.svelte.ts";

    interface Props {
        value: string;
        placeholder?: string;
        autocomplete?: string;
        name?: string;
        id?: string;
        disabled?: boolean;
        oninput?: (value: string) => void;
    }

    let {
        value = $bindable(""),
        placeholder,
        autocomplete,
        name,
        id,
        disabled = false,
        oninput,
    }: Props = $props();

    let visible = $state(false);

    function toggleVisibility(): void {
        visible = !visible;
    }

    function handleInput(e: Event & { currentTarget: HTMLInputElement }): void {
        value = e.currentTarget.value;
        oninput?.(value);
    }
</script>

<div class="gcp-hidden-field" data-audit-row="center">
    <input
        {id}
        {name}
        type={visible ? "text" : "password"}
        class="gcp-hidden-input"
        {placeholder}
        {autocomplete}
        {disabled}
        {value}
        oninput={handleInput}
    />
    <button
        type="button"
        class="gcp-hidden-toggle"
        aria-label={visible ? t("password.hide") : t("password.show")}
        onclick={toggleVisibility}
        {disabled}
    >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="gcp-eye-icon" aria-hidden="true" data-audit-opaque>
            {#if visible}
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
            {:else}
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
            {/if}
        </svg>
    </button>
</div>

<style>
    .gcp-hidden-field {
        position: relative;
        display: flex;
        align-items: center;
        width: 100%;
    }

    .gcp-hidden-input {
        width: 100%;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-3) var(--size-control-md);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
        font-family: inherit;
        font-size: 14px;
    }

    .gcp-hidden-input:focus-visible {
        border-color: var(--m3c-primary);
    }

    .gcp-hidden-toggle {
        position: absolute;
        inset-inline-end: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-md);
        height: var(--size-control-md);
        padding: 0;
        border: none;
        background: transparent;
        color: var(--m3c-on-surface-variant);
        cursor: pointer;
    }

    .gcp-hidden-toggle:hover {
        color: var(--m3c-on-surface);
    }

    @media (pointer: coarse) {
        .gcp-hidden-toggle {
            width: var(--size-control-lg);
            height: var(--size-control-lg);
        }

        .gcp-hidden-input {
            padding-inline-end: var(--size-control-lg);
        }
    }

    .gcp-eye-icon {
        width: var(--size-icon-md);
        height: var(--size-icon-md);
    }
</style>
