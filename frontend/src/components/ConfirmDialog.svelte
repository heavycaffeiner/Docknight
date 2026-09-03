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
    <div class="gcp-dialog-backdrop" onclick={oncancel} role="presentation"></div>
    <div
        bind:this={dialogEl}
        class="gcp-dialog"
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
    .gcp-dialog-backdrop {
        position: fixed;
        inset: 0;
        background: rgb(0 0 0 / 40%);
        z-index: 1000;
    }

    .gcp-dialog {
        position: fixed;
        inset-inline: 0;
        inset-block-start: 50%;
        transform: translateY(-50%);
        margin-inline: auto;
        max-width: var(--measure-form);
        width: calc(100% - var(--space-8));
        padding: var(--space-6);
        border-radius: var(--radius-md);
        background: var(--m3c-surface-container-high);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant), 0 8px 32px rgb(0 0 0 / 40%);
        color: var(--m3c-on-surface);
        z-index: 1001;
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    .gcp-dialog.keyboard-open {
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
        border-radius: var(--radius-xs);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
    }

    .cancel {
        background: transparent;
        color: var(--m3c-primary);
    }

    .cancel:hover {
        background: var(--m3c-surface-container-highest);
    }

    .confirm {
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
    }

    .confirm:hover {
        background: var(--m3c-primary-dim);
    }

    .confirm.danger {
        background: var(--m3c-error);
        color: var(--m3c-on-error);
    }
</style>
