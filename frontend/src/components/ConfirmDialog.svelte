<script lang="ts">
    import { Button, TextFieldOutlined } from "m3-svelte";
    import { trapFocus } from "../lib/a11y.ts";
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

    let surface = $state<HTMLElement | null>(null);
    let release: (() => void) | null = null;

    $effect(() => {
        if (open && surface !== null) {
            release = trapFocus(surface);
            return () => {
                release?.();
                release = null;
            };
        }
        return undefined;
    });

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            event.preventDefault();
            oncancel();
        }
    }
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
    <div class="scrim" data-audit-id="confirm-scrim">
        <div
            class="surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            bind:this={surface}
            data-audit-id="confirm-dialog"
            data-audit-column
        >
            <h2 id="confirm-title" class="type-headline">{title}</h2>
            <p class="body type-body-large">{body}</p>
            {#if passwordLabel !== undefined}
                <TextFieldOutlined
                    label={passwordLabel}
                    type="password"
                    bind:value={password}
                    autocomplete="current-password"
                />
            {/if}
            <div class="actions" data-audit-row="center">
                <Button variant="text" onclick={oncancel}>{t("actionCancel")}</Button>
                <span class="confirm" class:destructive>
                    <Button
                        variant="filled"
                        disabled={passwordLabel !== undefined && password === ""}
                        onclick={() => {
                            const value = password;
                            password = "";
                            onconfirm(value);
                        }}
                    >
                        {confirmLabel ?? t("actionConfirm")}
                    </Button>
                </span>
            </div>
        </div>
    </div>
{/if}

<style>
    .scrim {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: grid;
        place-items: center;
        padding: var(--space-4);
        background-color: rgb(var(--m3-scheme-scrim) / 0.5);
    }

    .surface {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        inline-size: 100%;
        max-inline-size: var(--measure-form);
        padding: var(--space-5);
        border-radius: var(--radius-xl);
        /* A field's floating label paints a patch to cut the outline, and defaults to the plain
           surface colour, which shows as a lighter box on anything else. */
        --m3-util-background: rgb(var(--m3-scheme-surface-container-high));
        background-color: rgb(var(--m3-scheme-surface-container-high));
        color: rgb(var(--m3-scheme-on-surface));
        box-shadow: var(--m3-util-elevation-3);
    }

    h2 {
        margin: 0;
    }

    .body {
        margin: 0;
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
        margin-block-start: var(--space-1);
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
