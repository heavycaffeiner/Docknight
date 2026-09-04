<script lang="ts">
    import { login } from "../lib/stores/session.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { reevaluate } from "../router.svelte.ts";
    import HiddenInput from "../components/HiddenInput.svelte";

    let username = $state("");
    let password = $state("");
    let remember = $state(true);
    let totpCode = $state("");
    let totpMode = $state(false);
    let submitting = $state(false);
    let errorMessage = $state<string | null>(null);

    let rateLimitedUntil = $state<number | null>(null);
    let rateLimitRemaining = $state(0);
    let countdownTimer: number | undefined;

    function startCountdown(seconds: number): void {
        rateLimitedUntil = Date.now() + seconds * 1000;
        rateLimitRemaining = seconds;
        clearInterval(countdownTimer);
        countdownTimer = window.setInterval(() => {
            if (rateLimitedUntil === null) return;
            const remaining = Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
            rateLimitRemaining = remaining;
            if (remaining <= 0) {
                rateLimitedUntil = null;
                clearInterval(countdownTimer);
            }
        }, 1000);
    }

    async function handleSubmit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (submitting || rateLimitedUntil !== null) return;

        submitting = true;
        errorMessage = null;

        try {
            const res = await login(username, password, remember, totpMode ? totpCode : undefined);
            if (res === "totp") {
                totpMode = true;
            } else {
                await reevaluate();
            }
        } catch (err: unknown) {
            if (err && typeof err === "object" && "code" in err) {
                const code = String(err.code);
                if (code === "rateLimited") {
                    const wait = ("values" in err && typeof err.values === "object" && err.values && "seconds" in err.values)
                        ? Number(err.values.seconds) || 30
                        : 30;
                    startCountdown(wait);
                    errorMessage = t("error.rateLimited", { seconds: wait });
                } else if (code === "unauthorized") {
                    errorMessage = t("error.authIncorrectCreds");
                } else {
                    errorMessage = "message" in err ? String(err.message) : t("error.internal");
                }
            } else {
                errorMessage = t("error.internal");
            }
        } finally {
            submitting = false;
        }
    }
</script>

<div class="gcp-auth-page" data-audit-root>
    <div class="gcp-auth-card" data-audit-column>
        <div class="gcp-auth-header" data-audit-column>
            <svg class="gcp-auth-logo" viewBox="0 0 24 24" aria-hidden="true" data-audit-opaque>
                <defs>
                    <linearGradient id="gcp-gemini-auth-login" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#4285f4" />
                        <stop offset="50%" stop-color="#9b72cb" />
                        <stop offset="100%" stop-color="#d96570" />
                    </linearGradient>
                </defs>
                <path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z" fill="url(#gcp-gemini-auth-login)" />
            </svg>
            <h1 class="text-headline gcp-auth-title">{t("auth.login.title")}</h1>
            <span class="text-body-medium gcp-auth-subtitle">to continue to Docknight</span>
        </div>

        {#if errorMessage !== null}
            <div class="gcp-auth-error text-body-medium" role="alert" data-audit-column>
                {errorMessage}
            </div>
        {/if}

        <form class="gcp-auth-form" onsubmit={handleSubmit} data-audit-column>
            {#if !totpMode}
                <div class="gcp-field" data-audit-column>
                    <label for="login-username" class="text-label gcp-label" data-audit-heading>{t("auth.login.username")}</label>
                    <input
                        id="login-username"
                        type="text"
                        class="gcp-input"
                        autocomplete="username"
                        required
                        disabled={submitting || rateLimitedUntil !== null}
                        bind:value={username}
                    />
                </div>

                <div class="gcp-field" data-audit-column>
                    <label for="login-password" class="text-label gcp-label" data-audit-heading>{t("auth.login.password")}</label>
                    <HiddenInput
                        id="login-password"
                        autocomplete="current-password"
                        disabled={submitting || rateLimitedUntil !== null}
                        bind:value={password}
                    />
                </div>

                <div class="gcp-auth-options" data-audit-row="center">
                    <label class="gcp-checkbox-label" data-audit-row="center">
                        <input
                            type="checkbox"
                            class="gcp-checkbox"
                            disabled={submitting || rateLimitedUntil !== null}
                            bind:checked={remember}
                        />
                        <span class="text-body-medium">{t("auth.login.remember")}</span>
                    </label>
                </div>

                <div class="gcp-auth-actions" data-audit-row="center">
                    <button
                        type="submit"
                        class="gcp-btn-primary"
                        disabled={submitting || rateLimitedUntil !== null}
                    >
                        {#if rateLimitedUntil !== null}
                            {t("error.rateLimited", { seconds: rateLimitRemaining })}
                        {:else}
                            {t("auth.login.submit")}
                        {/if}
                    </button>
                </div>
            {:else}
                <div class="gcp-field" data-audit-column>
                    <label for="login-totp" class="text-label gcp-label" data-audit-heading>{t("auth.login.totpLabel")}</label>
                    <input
                        id="login-totp"
                        type="text"
                        inputmode="numeric"
                        autocomplete="one-time-code"
                        class="gcp-input text-mono"
                        required
                        disabled={submitting || rateLimitedUntil !== null}
                        bind:value={totpCode}
                    />
                </div>

                <div class="gcp-auth-actions" data-audit-row="center">
                    <button
                        type="submit"
                        class="gcp-btn-primary"
                        disabled={submitting || rateLimitedUntil !== null}
                    >
                        {t("auth.login.totpSubmit")}
                    </button>
                </div>
            {/if}
        </form>
    </div>
</div>

<style>
    .gcp-auth-page {
        display: flex;
        align-items: center;
        justify-content: center;
        block-size: var(--viewport-block, 100dvh);
        padding: var(--space-4);
        background: var(--m3c-surface);
    }

    .gcp-auth-card {
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: var(--measure-form);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-lg);
        background: var(--m3c-surface-container-low);
        padding: var(--space-8);
        gap: var(--space-6);
    }

    @media (width < 600px) {
        .gcp-auth-card {
            border: none;
            background: transparent;
            padding: var(--space-4) 0;
        }
    }

    .gcp-auth-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--space-2);
    }

    .gcp-auth-logo {
        width: var(--space-8);
        height: var(--space-8);
        margin-block-end: var(--space-2);
    }

    .gcp-auth-title {
        font-weight: 500;
    }

    .gcp-auth-subtitle {
        color: var(--m3c-on-surface-variant);
    }

    .gcp-auth-error {
        padding: var(--space-3);
        border-radius: var(--radius-xs);
        background: var(--m3c-error-container);
        color: var(--m3c-on-error-container);
    }

    .gcp-auth-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    .gcp-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .gcp-label {
        color: var(--m3c-on-surface-variant);
        font-weight: 500;
    }

    .gcp-input {
        width: 100%;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--control-padding-inline);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-sm);
        background: var(--m3c-surface);
        color: var(--m3c-on-surface);
        font-family: inherit;
        font-size: var(--control-font-size);
        transition: border-color var(--duration-fast) var(--ease-standard);
    }

    .gcp-input:focus-visible {
        border-color: var(--m3c-primary);
    }

    .gcp-auth-options {
        display: flex;
        align-items: center;
    }

    .gcp-checkbox-label {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        min-block-size: var(--size-control-md);
        cursor: pointer;
        user-select: none;
    }

    .gcp-checkbox {
        width: var(--size-icon-sm);
        height: var(--size-icon-sm);
        accent-color: var(--m3c-primary);
    }

    .gcp-auth-actions {
        display: flex;
        justify-content: flex-end;
        margin-block-start: var(--space-2);
    }

    .gcp-btn-primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-4);
        border-radius: var(--radius-sm);
        border: none;
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        font-weight: 500;
        font-size: var(--control-font-size);
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease-standard);
    }

    .gcp-btn-primary:hover {
        background: var(--m3c-primary-dim);
    }

    .gcp-btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
</style>
