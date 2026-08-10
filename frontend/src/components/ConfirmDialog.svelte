<script lang="ts">
    import { Button, Dialog, TextFieldOutlined } from "m3-svelte";
    import { t } from "../lib/stores/i18n.svelte.ts";

    interface Props {
        open: boolean;
        title: string;
        body: string;
        confirmLabel?: string;
        destructive?: boolean;
        /** When set, the dialog asks for a password and passes it to onconfirm. */
        passwordLabel?: string;
        onconfirm: (password: string) => void;
        oncancel: () => void;
    }

    const {
        open,
        title,
        body,
        confirmLabel,
        destructive = false,
        passwordLabel,
        onconfirm,
        oncancel,
    }: Props = $props();

    let password = $state("");

    const blocked = $derived(passwordLabel !== undefined && password === "");

    function confirm(): void {
        if (blocked) return;
        const value = password;
        password = "";
        onconfirm(value);
    }

    // Escape and a press on the scrim close the native dialog on their own, leaving the caller still
    // holding it open. The guard keeps a close that the caller asked for from reading as a cancel.
    function onClose(): void {
        if (open) oncancel();
    }
</script>

{#if open}
    <Dialog
        {open}
        headline={title}
        aria-label={title}
        onclose={onClose}
        data-audit-id="confirm-dialog"
    >
        <div class="content" data-audit-column>
            <p class="body">{body}</p>
            {#if passwordLabel !== undefined}
                <!-- Enter confirms. The field sits outside the dialog's own form, so nothing else
                     would act on it. -->
                <div
                    onkeydown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        confirm();
                    }}
                    role="presentation"
                >
                    <TextFieldOutlined
                        label={passwordLabel}
                        type="password"
                        bind:value={password}
                        autocomplete="current-password"
                    />
                </div>
            {/if}
        </div>
        {#snippet buttons()}
            <Button variant="text" onclick={oncancel}>{t("actionCancel")}</Button>
            <span class="confirm" class:destructive>
                <Button variant="filled" disabled={blocked} onclick={confirm}>
                    {confirmLabel ?? t("actionConfirm")}
                </Button>
            </span>
        {/snippet}
    </Dialog>
{/if}

<style>
    .content {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    .body {
        margin: 0;
    }

    /* A destructive confirmation takes the error role, so the colour matches the consequence. Scoped
       to the confirming button: the row would recolour Cancel as well, which reads as the danger. */
    .confirm {
        display: contents;
    }

    .confirm.destructive {
        --m3-scheme-primary: var(--m3-scheme-error);
        --m3-scheme-on-primary: var(--m3-scheme-on-error);
    }
</style>
