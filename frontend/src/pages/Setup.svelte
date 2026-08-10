<script lang="ts">
    import { Button, TextFieldOutlined } from "m3-svelte";
    import { request } from "../lib/connection.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { login, session } from "../lib/stores/session.svelte.ts";
    import { toastError } from "../lib/stores/toast.svelte.ts";

    let username = $state("");
    let password = $state("");
    let repeat = $state("");
    let busy = $state(false);

    /** Evaluated live against the same policy the server enforces, as a hint rather than a gate. */
    const strong = $derived.by(() => {
        if (password.length < 8) return false;
        const classes = [/\p{L}/u, /\p{Nd}/u, /[^\p{L}\p{Nd}]/u].filter((re) => re.test(password)).length;
        return classes >= 2;
    });

    const mismatch = $derived(repeat !== "" && repeat !== password);

    async function submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (mismatch || busy) return;
        busy = true;
        try {
            await request("", "auth.setup", { username, password });
            // auth.setup returns no token, so the account is used immediately.
            await login(username, password);
            session.needsSetup = false;
        } catch (error) {
            toastError(error);
        } finally {
            busy = false;
        }
    }
</script>

<main class="page" data-audit-root data-grid-origin>
    <form class="card" onsubmit={submit} data-audit-id="setup-card" data-audit-column>
        <h1 class="type-headline">{t("setupTitle")}</h1>
        <p class="body type-body">{t("setupBody")}</p>

        <TextFieldOutlined
            label={t("setupUsername")}
            bind:value={username}
            autocomplete="username"
            required
        />
        <TextFieldOutlined
            label={t("setupPassword")}
            type="password"
            bind:value={password}
            autocomplete="new-password"
            required
        />
        <p class="hint type-label" class:ok={strong}>
            {strong ? t("setupStrengthOk") : t("setupStrengthHint")}
        </p>
        <TextFieldOutlined
            label={t("setupRepeat")}
            type="password"
            bind:value={repeat}
            autocomplete="new-password"
            error={mismatch}
            required
        />
        {#if mismatch}
            <p class="hint error type-label">{t("setupMismatch")}</p>
        {/if}

        <div class="submit">
            <Button variant="filled" type="submit" disabled={busy || mismatch}>
                {t("setupSubmit")}
            </Button>
        </div>
    </form>
</main>

<style>
    .page {
        display: grid;
        place-items: center;
        min-block-size: 100vh;
        padding: var(--space-4);
    }

    .card {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        inline-size: 100%;
        max-inline-size: var(--measure-form);
        padding: var(--space-6);
        border-radius: var(--radius-xl);
        /* A field's floating label paints a patch to cut the outline, and defaults to the plain
           surface colour, which shows as a lighter box on anything else. */
        --m3-util-background: rgb(var(--m3-scheme-surface-container-low));
        background-color: rgb(var(--m3-scheme-surface-container-low));
        color: rgb(var(--m3-scheme-on-surface));
    }

    h1 {
        margin: 0;
    }

    .body {
        margin: 0;
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .hint {
        margin: 0;
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .hint.ok {
        color: rgb(var(--m3-scheme-primary));
    }

    .hint.error {
        color: rgb(var(--m3-scheme-error));
    }

    .submit {
        display: flex;
        justify-content: flex-end;
        margin-block-start: var(--space-1);
    }
</style>
