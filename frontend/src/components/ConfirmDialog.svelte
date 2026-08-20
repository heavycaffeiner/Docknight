<script lang="ts">
    import { trapFocus } from "../lib/a11y.ts";
    import { keyboardOpen } from "../lib/viewport.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import HiddenInput from "./HiddenInput.svelte";

    interface Props {
        open: boolean;
        title: string;
        message: string;
        /** When set, the dialog collects a password before confirming (disableAuth, delete flows). */
        requirePassword?: boolean;
        password?: string;
        danger?: boolean;
        onconfirm: () => void;
        oncancel: () => void;
    }

    let {
        open,
        title,
        message,
        requirePassword = false,
        password = $bindable(""),
        danger = false,
        onconfirm,
        oncancel,
    }: Props = $props();

    let dialogEl = $state<HTMLElement | null>(null);

    $effect(() => {
        if (open && dialogEl !== null) {
            const release = trapFocus(dialogEl);
            return release;
        }
    });

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") oncancel();
    }
</script>

{#if open}
    <div class="backdrop" onclick={oncancel} role="presentation"></div>
    <div
        bind:this={dialogEl}
        class="dialog"
        class:keyboard-open={keyboardOpen.value}
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onkeydown={onKeydown}
        data-audit-id="confirm-dialog"
    >
        <h2 id="confirm-dialog-title" class="text-title">{title}</h2>
        <p class="text-body-medium">{message}</p>
        {#if requirePassword}
            <label class="password-label text-label" for="confirm-dialog-password">
                {t("settings.security.currentPassword")}
            </label>
            <HiddenInput id="confirm-dialog-password" bind:value={password} autocomplete="current-password" />
        {/if}
        <div class="actions" data-audit-row="center">
            <button type="button" class="cancel" onclick={oncancel}>{t("action.cancel")}</button>
            <button type="button" class="confirm" class:danger onclick={onconfirm}>
                {t("action.confirm")}
            </button>
        </div>
    </div>
{/if}

<style>
    .backdrop {
        position: fixed;
        inset: 0;
        background: rgb(0 0 0 / 32%);
        z-index: 100;
    }

    .dialog {
        position: fixed;
        inset-inline: 0;
        inset-block-start: 50%;
        transform: translateY(-50%);
        margin-inline: auto;
        max-width: var(--measure-form);
        width: calc(100% - var(--space-8));
        padding: var(--space-6);
        border-radius: var(--radius-lg);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        z-index: 101;
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    /*
     * A centred dialog on a viewport that has just halved needs to anchor near the top
     * instead, so the headline, the field, and the buttons stay visible above the keyboard.
     */
    .dialog.keyboard-open {
        inset-block-start: var(--space-4);
        transform: none;
    }

    .password-label {
        color: var(--m3c-on-surface-variant);
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
        margin-block-start: var(--space-2);
    }

    button {
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        border: none;
        border-radius: var(--radius-xl);
        cursor: pointer;
    }

    .cancel {
        background: transparent;
        color: var(--m3c-primary);
    }

    .confirm {
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
    }

    .confirm.danger {
        background: var(--m3c-error);
        color: var(--m3c-on-error);
    }
</style>
