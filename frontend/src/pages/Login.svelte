<script lang="ts">
    import { AppError } from "../../../common/errors.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { login } from "../lib/stores/session.svelte.ts";
    import { toastError } from "../lib/stores/toast.svelte.ts";
    import HiddenInput from "../components/HiddenInput.svelte";

    let username = $state("");
    let password = $state("");
    let remember = $state(false);
    let totp = $state("");
    let needsTotp = $state(false);
    let submitting = $state(false);
    let rateLimitedUntil = $state<number | null>(null);
    let now = $state(Date.now());

    $effect(() => {
        if (rateLimitedUntil === null) return;
        const timer = setInterval(() => {
            now = Date.now();
            if (rateLimitedUntil !== null && now >= rateLimitedUntil) rateLimitedUntil = null;
        }, 1000);
        return () => clearInterval(timer);
    });

    const remainingSeconds = $derived(
        rateLimitedUntil === null ? 0 : Math.max(0, Math.ceil((rateLimitedUntil - now) / 1000)),
    );

    async function onSubmit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        submitting = true;
        try {
            const result = await login(username, password, remember, needsTotp ? totp : undefined);
            if (result === "totp") {
                needsTotp = true;
            }
        } catch (error) {
            if (error instanceof AppError && error.code === "rateLimited") {
                // The server does not currently report the exact wait; a conservative fixed
                // window keeps the form disabled without inventing a number it never sent.
                rateLimitedUntil = Date.now() + 30_000;
            } else if (error instanceof AppError && error.code === "unauthorized" && needsTotp) {
                // A wrong or expired code: return to the code field with the message, and
                // keep the username and password already entered.
                totp = "";
            }
            toastError(error);
        } finally {
            submitting = false;
        }
    }
</script>

<div class="wrap">
    <form class="card" onsubmit={onSubmit} data-audit-root data-audit-column>
        <h1 class="text-headline">{t("auth.login.title")}</h1>

        {#if !needsTotp}
            <label class="field" for="login-username">
                <span class="text-label">{t("auth.login.username")}</span>
                <input
                    id="login-username"
                    type="text"
                    autocomplete="username"
                    required
                    bind:value={username}
                />
            </label>

            <label class="field" for="login-password">
                <span class="text-label">{t("auth.login.password")}</span>
                <HiddenInput id="login-password" bind:value={password} autocomplete="current-password" />
            </label>

            <label class="remember" data-audit-row="center">
                <input type="checkbox" bind:checked={remember} />
                <span class="text-body-medium">{t("auth.login.remember")}</span>
            </label>
        {:else}
            <label class="field" for="login-totp">
                <span class="text-label">{t("auth.login.totpLabel")}</span>
                <input
                    id="login-totp"
                    type="text"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    pattern="[0-9]{6}"
                    required
                    bind:value={totp}
                />
            </label>
        {/if}

        {#if rateLimitedUntil !== null}
            <p class="error text-label">{t("error.rateLimited", { seconds: remainingSeconds })}</p>
        {/if}

        <button type="submit" class="submit" disabled={submitting || rateLimitedUntil !== null}>
            {needsTotp ? t("auth.login.totpSubmit") : t("auth.login.submit")}
        </button>
    </form>
</div>

<style>
    .wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        block-size: 100dvh;
        padding: var(--space-4);
    }

    .card {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        width: 100%;
        max-width: var(--measure-form);
        padding: var(--space-6);
        border-radius: var(--radius-lg);
        background: var(--m3c-surface-container);
        color: var(--m3c-on-surface);
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    input[type="text"] {
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
    }

    .remember {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .error {
        color: var(--m3c-error);
    }

    .submit {
        height: var(--size-control-lg);
        margin-block-start: var(--space-2);
        border: none;
        border-radius: var(--radius-xl);
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        cursor: pointer;
    }

    .submit:disabled {
        opacity: 0.5;
        cursor: default;
    }
</style>
